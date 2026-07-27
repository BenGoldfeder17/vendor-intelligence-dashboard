// Weekly snapshot job for the Revenue Risk Monitor.
//
// WHY THIS EXISTS AND WHY IT'S URGENT:
// Two source tables hold only CURRENT state and are overwritten on each refresh —
//   • the price/item-master file's suppression flags (vendor-side)
//   • the replenishment code in the Catalog feed (Amazon-side de-listing)
// Panels 4 and 8 can show *today* from the live tables, but "what changed" needs
// history — and history cannot be backfilled. Every week this doesn't run is a
// week of transition data that is gone for good. So this ships before the panels.
//
// It reads the source tables and appends a dated row per key to app-owned
// snapshot tables. It writes ONLY to the app-owned snapshot dataset; it never
// touches ${warehouse.sourceDataset}.

import { query, feedsTable, insertSnapshotRows } from "./bigquery";
import { warehouse } from "@/config/app.config";

/** Monday (UTC) of the given date's ISO week — the snapshot's stable key. */
export function isoWeekMonday(d = new Date()): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  dt.setUTCDate(dt.getUTCDate() - offset);
  return dt.toISOString().slice(0, 10);
}

export interface SnapshotResult {
  snapshotDate: string;
  priceFileRows: number;
  replenRows: number;
  skipped: string[];
  errors: string[];
}

/**
 * Snapshot amazon_price_file suppression flags. Column names vary across exports,
 * so we alias defensively and skip the snapshot (rather than guess) if the
 * expected columns aren't present.
 */
async function snapshotPriceFile(
  snapshotDate: string,
  skipped: string[],
  errors: string[]
): Promise<number> {
  try {
    const rows = await query<{
      style: string | null;
      asin: string | null;
      send_zero_flags: string | null;
    }>(
      `SELECT
         CAST(Style AS STRING)         AS style,
         CAST(ASIN AS STRING)          AS asin,
         CAST(SendZeroFlags AS STRING) AS send_zero_flags
       FROM ${feedsTable(warehouse.tables.priceFile)}`
    );

    if (rows.length === 0) {
      skipped.push(`${warehouse.tables.priceFile} returned no rows.`);
      return 0;
    }

    const dated = rows.map((r) => ({
      snapshot_date: snapshotDate,
      style: r.style ?? "",
      asin: r.asin ?? "",
      send_zero_flags: r.send_zero_flags ?? "",
    }));

    return await insertSnapshotRows("price_file_snapshots", dated);
  } catch (e) {
    errors.push(`price_file snapshot failed: ${(e as Error).message}`);
    return 0;
  }
}

/**
 * Snapshot the Catalog replenishment code (PR → LR → OB transitions live here).
 * The Catalog Sourcing export column naming is uncertain, so this is best-effort
 * and skips cleanly if the columns aren't found.
 */
async function snapshotReplenishment(
  snapshotDate: string,
  skipped: string[],
  errors: string[]
): Promise<number> {
  try {
    const rows = await query<{
      asin: string | null;
      style: string | null;
      replenishment_code: string | null;
    }>(
      `SELECT
         CAST(ASIN AS STRING)              AS asin,
         CAST(Style AS STRING)             AS style,
         CAST(ReplenishmentCode AS STRING) AS replenishment_code
       FROM ${feedsTable(warehouse.tables.catalog)}`
    );

    if (rows.length === 0) {
      skipped.push(`${warehouse.tables.catalog} returned no rows.`);
      return 0;
    }

    const dated = rows.map((r) => ({
      snapshot_date: snapshotDate,
      asin: r.asin ?? "",
      style: r.style ?? "",
      replenishment_code: r.replenishment_code ?? "",
    }));

    return await insertSnapshotRows("replenishment_snapshots", dated);
  } catch (e) {
    // Table name / columns unconfirmed — treat as skip, not hard failure.
    skipped.push(
      `replenishment snapshot skipped (${(e as Error).message}). ` +
        "Confirm the Catalog Sourcing table name and replenishment column, then re-run."
    );
    return 0;
  }
}

/** Run the full weekly snapshot. Idempotent-ish: re-running appends same-dated rows. */
export async function runSnapshot(date = new Date()): Promise<SnapshotResult> {
  const snapshotDate = isoWeekMonday(date);
  const skipped: string[] = [];
  const errors: string[] = [];

  const priceFileRows = await snapshotPriceFile(snapshotDate, skipped, errors);
  const replenRows = await snapshotReplenishment(snapshotDate, skipped, errors);

  return { snapshotDate, priceFileRows, replenRows, skipped, errors };
}
