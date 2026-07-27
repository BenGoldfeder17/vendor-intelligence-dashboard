// Catalog Items API (2022-04-01). Fetches per-ASIN listing content:
// title, brand, images, bullet points, description, product type, sales rank,
// and the full flattened attribute set ("All Amazon Info").

import { getConfig } from "./config";
import { request, SpapiError } from "./client";
import type { AmazonImage } from "../types";

const CATALOG_BASE = "/catalog/2022-04-01";

interface RawAttrValue {
  value?: unknown;
  marketplace_id?: string;
}

interface CatalogItem {
  asin: string;
  attributes?: Record<string, RawAttrValue[]>;
  images?: Array<{
    marketplaceId: string;
    images: Array<{ variant: string; link: string; height?: number; width?: number }>;
  }>;
  productTypes?: Array<{ marketplaceId: string; productType: string }>;
  salesRanks?: Array<{
    marketplaceId: string;
    classificationRanks?: Array<{ classificationId: string; title: string; link?: string; rank: number }>;
    displayGroupRanks?: Array<{ websiteDisplayGroup: string; title: string; link?: string; rank: number }>;
  }>;
  summaries?: Array<{
    marketplaceId: string;
    brand?: string;
    itemName?: string;
    manufacturer?: string;
    modelNumber?: string;
    partNumber?: string;
    color?: string;
    size?: string;
  }>;
}

export interface NormalizedCatalog {
  asin: string;
  title: string | null;
  brand: string | null;
  images: AmazonImage[];
  bullets: string[];
  description: string | null;
  productType: string | null;
  salesRank: number | null;
  salesRankCategory: string | null;
  attributes: Record<string, unknown>;
  /** First values of the configured style attributes, if present. */
  styleRaw: string | null;
  style10Raw: string | null;
}

/** Fetch and normalize a single ASIN. Returns null if not found (404). */
export async function getCatalogItem(asin: string): Promise<NormalizedCatalog | null> {
  const cfg = getConfig();
  let item: CatalogItem;
  try {
    item = await request<CatalogItem>({
      path: `${CATALOG_BASE}/items/${encodeURIComponent(asin)}`,
      query: {
        marketplaceIds: cfg.marketplaceId,
        includedData: ["summaries", "attributes", "images", "productTypes", "salesRanks"],
      },
    });
  } catch (e) {
    if (e instanceof SpapiError && e.status === 404) return null;
    throw e;
  }

  const summary = pickMarketplace(item.summaries, cfg.marketplaceId);
  const attrs = item.attributes ?? {};

  const title =
    summary?.itemName || firstAttr(attrs, "item_name") || null;
  const brand = summary?.brand || firstAttr(attrs, "brand") || null;
  const bullets = allAttr(attrs, "bullet_point");
  const description = firstAttr(attrs, "product_description") || null;
  const productType = pickMarketplace(item.productTypes, cfg.marketplaceId)?.productType ?? null;

  const ranks = pickMarketplace(item.salesRanks, cfg.marketplaceId);
  const topRank = ranks?.displayGroupRanks?.[0] ?? ranks?.classificationRanks?.[0] ?? null;

  const images = normalizeImages(item, cfg.marketplaceId);

  return {
    asin: item.asin ?? asin,
    title,
    brand,
    images,
    bullets,
    description,
    productType,
    salesRank: topRank ? topRank.rank : null,
    salesRankCategory: topRank ? topRank.title : null,
    attributes: flattenAttributes(attrs),
    styleRaw: firstAttr(attrs, cfg.styleAttr) || summary?.modelNumber || null,
    style10Raw: firstAttr(attrs, cfg.style10Attr) || summary?.partNumber || null,
  };
}

function normalizeImages(item: CatalogItem, marketplaceId: string): AmazonImage[] {
  const group = pickMarketplace(item.images, marketplaceId);
  if (!group?.images) return [];
  // De-dupe by variant, keep the largest of each.
  const byVariant = new Map<string, AmazonImage>();
  for (const img of group.images) {
    const existing = byVariant.get(img.variant);
    const candidate: AmazonImage = {
      variant: img.variant,
      link: img.link,
      width: img.width,
      height: img.height,
    };
    if (!existing || (candidate.width ?? 0) > (existing.width ?? 0)) {
      byVariant.set(img.variant, candidate);
    }
  }
  // MAIN first, then the rest.
  return [...byVariant.values()].sort((a, b) =>
    a.variant === "MAIN" ? -1 : b.variant === "MAIN" ? 1 : a.variant.localeCompare(b.variant)
  );
}

function pickMarketplace<T extends { marketplaceId: string }>(
  arr: T[] | undefined,
  marketplaceId: string
): T | undefined {
  if (!arr?.length) return undefined;
  return arr.find((x) => x.marketplaceId === marketplaceId) ?? arr[0];
}

function firstAttr(attrs: Record<string, RawAttrValue[]>, key: string): string | null {
  const v = attrs[key]?.[0]?.value;
  return v == null ? null : String(v);
}

function allAttr(attrs: Record<string, RawAttrValue[]>, key: string): string[] {
  return (attrs[key] ?? []).map((x) => String(x.value ?? "")).filter(Boolean);
}

/** Reduce Amazon's `{ key: [{value, marketplace_id}] }` to readable values. */
function flattenAttributes(attrs: Record<string, RawAttrValue[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, arr] of Object.entries(attrs)) {
    if (!Array.isArray(arr)) {
      out[key] = arr;
      continue;
    }
    const values = arr.map((x) => (x && typeof x === "object" && "value" in x ? x.value : x));
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}
