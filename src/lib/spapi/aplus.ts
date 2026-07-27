// A+ Content API (2020-11-01), doc-centric.
//
// We list every published content document (far fewer than ASINs), then for each:
//   • getContentDocument  → the content modules (flattened to text + image URLs)
//   • listContentDocumentAsinRelations → which ASINs it covers, PLUS each ASIN's
//     real product title and main catalog image URL and parent ASIN.
//
// This means that even without the Catalog Items (Product Listing) role we still
// recover real titles + images for every A+-covered ASIN, and A+ module images
// render via the public media-library URL.

import { getConfig } from "./config";
import { request, SpapiError } from "./client";
import type { AplusBlock, AplusDocument } from "../types";

const APLUS_BASE = "/aplus/2020-11-01";
const MEDIA_BASE = "https://m.media-amazon.com/images/S/";

export interface AsinInfo {
  title: string | null;
  imageUrl: string | null;
  parent: string | null;
}

export interface AplusFetchResult {
  aplusByAsin: Map<string, AplusDocument[]>;
  infoByAsin: Map<string, AsinInfo>;
  docCount: number;
}

interface SearchResponse {
  contentMetadataRecords?: Array<{
    contentReferenceKey: string;
    contentMetadata?: { name?: string; status?: string };
  }>;
  nextPageToken?: string | null;
}

interface ContentModule {
  contentModuleType: string;
  [key: string]: unknown;
}

interface ContentDocResponse {
  contentRecord?: {
    contentDocument?: { name?: string; contentModuleList?: ContentModule[] };
    contentMetadata?: { name?: string; status?: string };
  };
}

interface AsinRelationsResponse {
  asinMetadataSet?: Array<{
    asin: string;
    parent?: string;
    title?: string;
    imageUrl?: string;
  }>;
  nextPageToken?: string | null;
}

export async function fetchAllAplus(onProgress?: (m: string) => void): Promise<AplusFetchResult> {
  const cfg = getConfig();
  const mkt = cfg.marketplaceId;

  // 1) Enumerate all content documents.
  const docs: Array<{ key: string; name?: string; status?: string }> = [];
  let pageToken: string | null | undefined;
  try {
    do {
      const res = await request<SearchResponse>({
        path: `${APLUS_BASE}/contentDocuments`,
        query: { marketplaceId: mkt, pageToken: pageToken ?? undefined },
      });
      for (const r of res.contentMetadataRecords ?? []) {
        docs.push({ key: r.contentReferenceKey, name: r.contentMetadata?.name, status: r.contentMetadata?.status });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
  } catch (e) {
    if (e instanceof SpapiError && (e.status === 403 || e.status === 404)) {
      onProgress?.(`A+ content unavailable (${e.status}).`);
      return { aplusByAsin: new Map(), infoByAsin: new Map(), docCount: 0 };
    }
    throw e;
  }

  onProgress?.(`A+: ${docs.length} content documents found.`);

  const aplusByAsin = new Map<string, AplusDocument[]>();
  const infoByAsin = new Map<string, AsinInfo>();
  let done = 0;

  await pool(docs, 4, async (d) => {
    // a) content modules
    let blocks: AplusBlock[] = [];
    try {
      const doc = await request<ContentDocResponse>({
        path: `${APLUS_BASE}/contentDocuments/${encodeURIComponent(d.key)}`,
        query: { marketplaceId: mkt, includedDataSet: ["CONTENTS", "METADATA"] },
      });
      const modules = doc.contentRecord?.contentDocument?.contentModuleList ?? [];
      blocks = modules.map(flattenModule);
    } catch {
      /* keep the doc with empty blocks rather than dropping it */
    }
    const aplusDoc: AplusDocument = { contentReferenceKey: d.key, name: d.name, status: d.status, blocks };

    // b) ASIN relations (title + image + parent), paginated
    let token: string | null | undefined;
    try {
      do {
        const rel = await request<AsinRelationsResponse>({
          path: `${APLUS_BASE}/contentDocuments/${encodeURIComponent(d.key)}/asins`,
          query: { marketplaceId: mkt, includedDataSet: ["METADATA"], pageToken: token ?? undefined },
        });
        for (const a of rel.asinMetadataSet ?? []) {
          const arr = aplusByAsin.get(a.asin) ?? [];
          arr.push(aplusDoc);
          aplusByAsin.set(a.asin, arr);
          if (!infoByAsin.has(a.asin)) {
            infoByAsin.set(a.asin, {
              title: a.title ?? null,
              imageUrl: a.imageUrl ?? null,
              parent: a.parent ?? null,
            });
          }
        }
        token = rel.nextPageToken;
      } while (token);
    } catch {
      /* ignore relation failure for a single doc */
    }

    done++;
    if (done % 25 === 0) onProgress?.(`A+: processed ${done}/${docs.length} docs, ${infoByAsin.size} ASIN(s)…`);
  });

  onProgress?.(`A+: ${docs.length} docs → ${aplusByAsin.size} ASIN(s) with content/titles/images.`);
  return { aplusByAsin, infoByAsin, docCount: docs.length };
}

/** Recursively pull text + image URLs out of a content module. */
function flattenModule(mod: ContentModule): AplusBlock {
  // Structured comparison / spec tables get rendered as real tables, not text.
  const table = extractTable(mod);
  if (table) {
    const images: string[] = [];
    collectImages(mod, images);
    return { type: mod.contentModuleType, text: table.heading ?? "", images: dedupe(images), heading: table.heading, table: { headers: table.headers, rows: table.rows } };
  }

  const texts: string[] = [];
  const images: string[] = [];

  const walk = (node: unknown): void => {
    if (node == null || typeof node === "string" || typeof node === "number") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // Only real copy (headline/body `.value`). altText is keyword-stuffed SEO text
      // baked for the image — we keep it as the image's alt attribute, not body copy.
      if (typeof obj.value === "string" && obj.value.trim()) texts.push(stripTags(obj.value));
      // A+ images are referenced by an upload-destination id, renderable via the
      // public media-library URL.
      if (typeof obj.uploadDestinationId === "string" && obj.uploadDestinationId) {
        images.push(MEDIA_BASE + obj.uploadDestinationId);
      }
      if (typeof obj.url === "string" && obj.url.startsWith("http")) images.push(obj.url);
      for (const v of Object.values(obj)) walk(v);
    }
  };
  walk(mod);

  return { type: mod.contentModuleType, text: dedupe(texts).join("\n"), images: dedupe(images) };
}

interface PlainText {
  position?: number;
  value?: string;
}

/** Build a table for STANDARD_COMPARISON_TABLE / STANDARD_TECH_SPECS modules. */
function extractTable(
  mod: ContentModule
): { headers: string[]; rows: string[][]; heading?: string } | null {
  const ct = mod.standardComparisonTable as
    | {
        productColumns?: Array<{ position?: number; title?: string; asin?: string; metrics?: PlainText[] }>;
        metricRowLabels?: PlainText[];
      }
    | undefined;
  if (ct?.productColumns?.length) {
    const cols = [...ct.productColumns].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const labels = [...(ct.metricRowLabels ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const headers = ["", ...cols.map((c) => clean(c.title) || c.asin || "")];
    const rows = labels.map((rl) => {
      const cells = cols.map((c) => clean((c.metrics ?? []).find((m) => m.position === rl.position)?.value));
      return [clean(rl.value), ...cells];
    });
    return { headers, rows };
  }

  const ts = mod.standardTechSpecs as
    | { headline?: { value?: string } | string; specificationList?: Array<{ label?: string; value?: string }> }
    | undefined;
  if (ts?.specificationList?.length) {
    const heading = typeof ts.headline === "string" ? ts.headline : ts.headline?.value;
    return {
      headers: ["Specification", "Value"],
      rows: ts.specificationList.map((s) => [clean(s.label), clean(s.value)]),
      heading: heading ? clean(heading) : undefined,
    };
  }
  return null;
}

function collectImages(node: unknown, out: string[]): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectImages(n, out));
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.uploadDestinationId === "string" && obj.uploadDestinationId) out.push(MEDIA_BASE + obj.uploadDestinationId);
  for (const v of Object.values(obj)) collectImages(v, out);
}

function clean(s: unknown): string {
  return typeof s === "string" ? stripTags(s) : "";
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}
function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await worker(items[cur]);
    }
  });
  await Promise.all(runners);
}
