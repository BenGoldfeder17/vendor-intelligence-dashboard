// Net PPM via Data Kiosk vendor analytics — the API replacement for the manual
// ARA CSV upload.
//
// Builds a GraphQL query against analytics_vendorAnalytics_2024_09_30 sourcingView,
// pulls the same fields the ARA export carries (netPPM, shippedCogs, contraCogs,
// salesDiscount) grouped by asin + brandCode, flattens the nested JSONL into the
// flat NetPpmRow shape the risk panels already consume, and stores it in the same
// slot the CSV upload used — so every downstream panel works unchanged.
//
// Caveat that does NOT go away with the API: Amazon's contraCogs is an ESTIMATE,
// not your actual co-op deductions, so netPPM here is still Amazon's approximation.
// The corrected-margin path (real deductions) remains the more accurate source.

import { getConfig } from "./spapi/config";
import { submitQuery, collectIfReady } from "./spapi/dataKiosk";
import { writeAraNetPpm, type AraNetPpmData } from "./araNetPpm";
import { readJson, writeJson, deleteJson } from "./storage";
import type { NetPpmRow } from "./riskMonitor";

/**
 * Build the vendor-analytics GraphQL query. Sourcing view (matches the vendor
 * codes POs are placed against), grouped by asin + brandCode, weekly aggregation.
 * netPPM comes back as a percentage number; shipped revenue is derived from
 * shippedUnitsWithRevenue.value.amount so the floor gauge can weight by it.
 */
export function buildNetPpmQuery(startDate: string, endDate: string, currency = "USD"): string {
  return `
query NetPpm {
  analytics_vendorAnalytics_2024_09_30 {
    sourcingView(
      startDate: "${startDate}"
      endDate: "${endDate}"
      aggregateBy: WEEK
      currencyCode: "${currency}"
    ) {
      startDate
      endDate
      metrics {
        groupByKey { asin brandCode }
        metrics {
          shippedOrders {
            shippedUnitsWithRevenue { units value { amount currencyCode } }
          }
          costs {
            netPPM
            shippedCogs { amount currencyCode }
            contraCogs { amount currencyCode }
            salesDiscount { amount currencyCode }
          }
        }
      }
    }
  }
}`.trim();
}

// ── Shapes of the nested JSONL Data Kiosk returns ──

/**
 * Flatten Data Kiosk's JSONL into NetPpmRow[].
 *
 * Data Kiosk does NOT necessarily mirror the GraphQL query's nesting in its
 * output — in practice each metric row is often emitted as its own JSONL line
 * with a flatter shape. So rather than assume one exact structure, we locate the
 * fields we need wherever they sit:
 *   • asin / brandCode           — the grouping key (may be nested under groupByKey)
 *   • netPPM                      — a percentage number (÷100 to a fraction)
 *   • shipped revenue amount      — from shippedUnitsWithRevenue.value.amount
 * Each recognized line contributes to a per-ASIN accumulator; repeated ASINs
 * across weekly buckets are revenue-weighted into one row.
 *
 * netPPM is returned by Amazon as a percentage (e.g. 36.07).
 */
export function flattenNetPpm(lines: Record<string, unknown>[]): NetPpmRow[] {
  const acc = new Map<
    string,
    { brandCode: string | null; revenue: number; marginRevenue: number; sawNet: boolean }
  >();

  for (const raw of lines) {
    // A single JSONL line may itself contain an array of metric nodes, or be one
    // node, or wrap everything under the dataset/view keys. Collect candidate
    // metric objects from all of these forms.
    for (const node of extractMetricNodes(raw)) {
      const asin = firstString(node, ["asin"]);
      if (!asin) continue;
      const brandCode = firstString(node, ["brandCode"]);
      const netPct = firstNumber(node, ["netPPM", "netPpm"]);
      const revenue = extractRevenue(node);

      const key = asin.toUpperCase();
      const prev =
        acc.get(key) ?? { brandCode: brandCode ?? null, revenue: 0, marginRevenue: 0, sawNet: false };
      prev.brandCode = prev.brandCode ?? brandCode ?? null;
      prev.revenue += revenue;
      if (netPct != null) {
        prev.marginRevenue += (netPct / 100) * (revenue || 1); // weight; falls back to 1 if no rev
        prev.sawNet = true;
      }
      acc.set(key, prev);
    }
  }

  const rows: NetPpmRow[] = [];
  for (const [asin, v] of acc) {
    const weightBase = v.revenue > 0 ? v.revenue : v.sawNet ? countWeight(v) : 0;
    rows.push({
      asin,
      brandCode: v.brandCode,
      netPpm: v.sawNet && weightBase > 0 ? v.marginRevenue / weightBase : null,
      priorNetPpm: null,
      shippedRevenue: v.revenue > 0 ? v.revenue : null,
    });
  }
  return rows;
}

// When there's no revenue to weight by, marginRevenue was summed with weight 1
// per bucket, so divide by the bucket count (approximated as 1 here — single
// bucket is the common no-revenue case).
function countWeight(_v: { marginRevenue: number }): number {
  return 1;
}

/**
 * Pull metric-bearing objects out of one JSONL line regardless of nesting.
 * Handles: a flat row; a { metrics: [...] } wrapper; and the deep
 * dataset→view→metrics[] structure. Recurses to find any object that has an
 * "asin" (directly or under groupByKey).
 */
function extractMetricNodes(line: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object" || depth > 8) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    const obj = v as Record<string, unknown>;
    // A node "counts" if it has an asin directly or via groupByKey.
    const hasAsin =
      typeof obj.asin === "string" ||
      (obj.groupByKey &&
        typeof (obj.groupByKey as Record<string, unknown>).asin === "string");
    if (hasAsin) found.push(flattenGroupKey(obj));
    // Keep descending regardless, to catch metrics[] arrays.
    for (const val of Object.values(obj)) visit(val, depth + 1);
  };
  visit(line, 0);
  return found;
}

/** Merge groupByKey.{asin,brandCode} up to the node so lookups are uniform. */
function flattenGroupKey(obj: Record<string, unknown>): Record<string, unknown> {
  const gk = obj.groupByKey as Record<string, unknown> | undefined;
  if (!gk) return obj;
  return { ...obj, asin: gk.asin ?? obj.asin, brandCode: gk.brandCode ?? obj.brandCode };
}

/** Depth-first search for the first string value under any of the given keys. */
function firstString(obj: unknown, keys: string[]): string | null {
  const hit = deepFind(obj, keys, (x) => typeof x === "string" && x.length > 0);
  return (hit as string) ?? null;
}
function firstNumber(obj: unknown, keys: string[]): number | null {
  const hit = deepFind(obj, keys, (x) => typeof x === "number" && Number.isFinite(x));
  return (hit as number) ?? null;
}

/** Revenue: prefer shippedUnitsWithRevenue.value.amount, else any *revenue* amount. */
function extractRevenue(node: Record<string, unknown>): number {
  const viaShipped = deepFind(
    node,
    ["shippedUnitsWithRevenue"],
    (x) => typeof x === "object" && x !== null
  ) as Record<string, unknown> | null;
  if (viaShipped) {
    const amt = deepFind(viaShipped, ["amount"], (x) => typeof x === "number");
    if (typeof amt === "number") return amt;
  }
  return 0;
}

/**
 * Find the first value under a matching key that passes `ok`. Searches the object
 * tree breadth-ish via recursion; the first key match whose value satisfies ok wins.
 */
function deepFind(
  obj: unknown,
  keys: string[],
  ok: (x: unknown) => boolean,
  depth = 0
): unknown {
  if (!obj || typeof obj !== "object" || depth > 8) return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepFind(item, keys, ok, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    if (k in rec && ok(rec[k])) return rec[k];
  }
  for (const v of Object.values(rec)) {
    const r = deepFind(v, keys, ok, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

export interface NetPpmPullResult {
  ok: boolean;
  rowCount: number;
  /** How many JSONL lines Amazon returned, before flattening. */
  linesReturned?: number;
  status: string;
  error?: string;
  /** First ~2KB of raw JSONL when rows came back empty — for diagnosis. */
  rawSample?: string;
}

// A submitted-but-not-yet-collected query id is persisted so the pull survives
// across requests: submit returns instantly, and a later check collects results.
interface PendingPull {
  queryId: string;
  submittedAt: string;
  start: string;
  end: string;
}
const PENDING_KEY = "net-ppm-pending.json";

export interface StartPullResult {
  started: boolean;
  queryId?: string;
  /** True when a query was already in flight (we didn't submit a duplicate). */
  alreadyRunning?: boolean;
  error?: string;
}

/**
 * Start a Net PPM pull: submit the Data Kiosk query and return immediately.
 * Does NOT wait for Amazon — that's what caused the timeout. The query id is
 * stored; call `checkPull` later to collect results when Amazon finishes.
 */
export async function startNetPpmPull(
  startDate?: string,
  endDate?: string
): Promise<StartPullResult> {
  const cfg = getConfig();
  const end = endDate ?? isoDate(new Date());
  const start = startDate ?? isoDate(daysAgo(cfg.salesLookbackDays || 90));

  // If one is already pending, don't submit a duplicate (Amazon rejects
  // concurrent queries for the same dataset anyway).
  const existing = await readJson<PendingPull>(PENDING_KEY);
  if (existing?.queryId) {
    return { started: false, alreadyRunning: true, queryId: existing.queryId };
  }

  try {
    const queryId = await submitQuery(buildNetPpmQuery(start, end));
    await writeJson(PENDING_KEY, {
      queryId,
      submittedAt: new Date().toISOString(),
      start,
      end,
    } satisfies PendingPull);
    return { started: true, queryId };
  } catch (e) {
    return { started: false, error: (e as Error).message };
  }
}

export interface CheckPullResult {
  state: "idle" | "pending" | "stored" | "empty" | "failed";
  rowCount?: number;
  linesReturned?: number;
  processingStatus?: string;
  error?: string;
  rawSample?: string;
  submittedAt?: string;
}

/**
 * Check a pending pull once. Cheap and safe to call repeatedly (from a status
 * poll or a scheduler). When Amazon is done it fetches, flattens, stores into the
 * ARA slot, and clears the pending marker. While Amazon is still working it just
 * returns "pending" without blocking.
 */
export async function checkNetPpmPull(): Promise<CheckPullResult> {
  const pending = await readJson<PendingPull>(PENDING_KEY);
  if (!pending?.queryId) return { state: "idle" };

  const result = await collectIfReady(pending.queryId);

  if (result.state === "pending") {
    return {
      state: "pending",
      processingStatus: result.processingStatus,
      submittedAt: pending.submittedAt,
    };
  }

  // Any terminal state clears the pending marker so a new pull can start.
  await deleteJson(PENDING_KEY).catch(() => {});

  if (result.state === "failed" || result.state === "cancelled") {
    return {
      state: "failed",
      processingStatus: result.processingStatus,
      error: result.error ?? `Query ended ${result.processingStatus}.`,
    };
  }

  const rows = flattenNetPpm(result.rows);
  if (rows.length === 0) {
    return {
      state: "empty",
      linesReturned: result.rows.length,
      processingStatus: result.processingStatus,
      rawSample: result.rawSample,
      error:
        result.rows.length > 0
          ? `Amazon returned ${result.rows.length} row(s) but none matched the expected fields.`
          : undefined,
    };
  }

  const data: AraNetPpmData = {
    meta: {
      uploadedAt: new Date().toISOString(),
      rowCount: rows.length,
      detectedColumns: {
        source: "data-kiosk",
        dataset: "analytics_vendorAnalytics_2024_09_30 sourcingView",
        range: `${pending.start}..${pending.end}`,
      },
    },
    rows,
  };
  await writeAraNetPpm(data);
  return {
    state: "stored",
    rowCount: rows.length,
    linesReturned: result.rows.length,
    processingStatus: result.processingStatus,
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
