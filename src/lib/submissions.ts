// Product submissions: drafts, the status pipeline, and reconciliation.
//
// Pipeline:  draft → ready → submitted → live
//
//   draft      being filled in
//   ready      passes schema validation; payload is complete
//   submitted  handed to Amazon (Vendor Central item setup today; the Listings
//              Items API once the Product Listing role is granted)
//   live       the ASIN showed up in our own catalog sync — closing the loop
//              automatically, which is the thing Vendor Central won't tell you
//
// Persistence rides on ./storage, so this works on Cloud Run (GCS) and locally.

import { readJson, writeJson } from "./storage";
import { readAggregate } from "./cache";

export type SubmissionStatus = "draft" | "ready" | "submitted" | "live";

export interface Submission {
  id: string;
  /** Vendor SKU / your brand style code — the key we reconcile against the catalog. */
  sku: string;
  productType: string;
  status: SubmissionStatus;
  /** Raw form values, keyed by schema attribute name. */
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  liveAt: string | null;
  asin: string | null;
  note: string | null;
}

const KEY = "submissions.json";

export async function listSubmissions(): Promise<Submission[]> {
  return (await readJson<Submission[]>(KEY)) ?? [];
}

export async function saveSubmissions(subs: Submission[]): Promise<void> {
  await writeJson(KEY, subs);
}

export async function upsertSubmission(sub: Submission): Promise<Submission> {
  const all = await listSubmissions();
  const i = all.findIndex((s) => s.id === sub.id);
  if (i >= 0) all[i] = sub;
  else all.push(sub);
  await saveSubmissions(all);
  return sub;
}

export async function deleteSubmission(id: string): Promise<void> {
  const all = await listSubmissions();
  await saveSubmissions(all.filter((s) => s.id !== id));
}

/**
 * Close the loop: anything in "submitted" flips to "live" once its SKU turns up
 * in the catalog (matched on style / style10) or its ASIN appears. Cheap enough
 * to run on every list — it only touches storage when something actually changed.
 */
export async function reconcile(subs: Submission[]): Promise<Submission[]> {
  if (!subs.some((s) => s.status === "submitted")) return subs;

  const agg = await readAggregate();
  if (!agg) return subs;

  const asinByCode = new Map<string, string>();
  for (const p of agg.products) {
    if (p.style) asinByCode.set(p.style.toUpperCase(), p.asin);
    if (p.style10) asinByCode.set(p.style10.toUpperCase(), p.asin);
  }
  const knownAsins = new Set(agg.products.map((p) => p.asin));

  const now = new Date().toISOString();
  let changed = false;

  const out = subs.map((s): Submission => {
    if (s.status !== "submitted") return s;
    const hit =
      s.asin && knownAsins.has(s.asin) ? s.asin : asinByCode.get(s.sku.toUpperCase()) ?? null;
    if (!hit) return s;
    changed = true;
    return { ...s, status: "live", liveAt: now, asin: hit, updatedAt: now };
  });

  if (changed) await saveSubmissions(out);
  return out;
}
