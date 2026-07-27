// Cache for the aggregated dataset and the live sync status.
// Aggregation is expensive (async reports + per-ASIN calls), so the dashboard
// always reads this cache; a sync job refreshes it on demand. Storage backend
// (GCS on Cloud Run, local .data/ in dev) is chosen in ./storage.

import type { Aggregate, SyncStatus } from "./types";
import { accountFingerprint, isConfigured } from "./spapi/config";
import { readJson, writeJson } from "./storage";

const AGG_KEY = "aggregate.json";
const STATUS_KEY = "sync-status.json";

// ── In-memory aggregate cache ──
// The container is pinned warm (min-instances=1), so the parsed aggregate can
// live in module scope and be reused across requests. We only re-download when a
// sync has replaced it. writeAggregate() bumps this counter; each read serves the
// cached object for up to STALE_MS before re-checking, so back-to-back page loads
// and date-range toggles don't re-fetch or re-parse multiple MB of JSON.
let memAgg: Aggregate | null = null;
let memWrittenAt = 0;   // set by writeAggregate on this instance
let memLoadedAt = 0;    // when we last pulled from storage
const STALE_MS = 15_000;

export async function readAggregate(): Promise<Aggregate | null> {
  const now = Date.now();
  // Serve from memory if fresh and not superseded by a local write.
  if (memAgg && now - memLoadedAt < STALE_MS && memLoadedAt >= memWrittenAt) {
    return applyAccountGuard(memAgg);
  }
  const agg = await readJson<Aggregate>(AGG_KEY);
  memAgg = agg;
  memLoadedAt = now;
  if (!agg) return null;
  // If the .env credentials changed (different vendor), don't serve stale data.
  return applyAccountGuard(agg);
}

/** Account-mismatch guard, factored out so the memory path reuses it. */
function applyAccountGuard(agg: Aggregate): Aggregate | null {
  if (isConfigured() && agg.meta?.account && agg.meta.account !== accountFingerprint()) {
    return null;
  }
  return agg;
}

export async function writeAggregate(agg: Aggregate): Promise<void> {
  await writeJson(AGG_KEY, agg);
  // Refresh this instance's cache immediately so the next read is current.
  memAgg = agg;
  memWrittenAt = Date.now();
  memLoadedAt = memWrittenAt;
}

export async function readStatus(): Promise<SyncStatus | null> {
  return readJson<SyncStatus>(STATUS_KEY);
}

export async function writeStatus(status: SyncStatus): Promise<void> {
  await writeJson(STATUS_KEY, status);
}
