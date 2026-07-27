// Read-only BigQuery access for the Revenue Risk Monitor.
//
// This module NEVER writes to a source table. It runs SELECT queries against the
// ${warehouse.sourceDataset} dataset and, for snapshots, writes ONLY to tables this app owns
// (the `*_snapshots` tables in a separate app-owned dataset). Source tables
// (asin_style_map, amazon_inventory, amazon_price_file, and the ARA uploads) are
// strictly read-only.
//
// Auth: on Cloud Run the runtime service account is picked up via ADC; locally,
// `gcloud auth application-default login`. The runtime SA needs
// roles/bigquery.dataViewer on ${warehouse.sourceDataset} and roles/bigquery.dataEditor +
// jobUser on the app-owned snapshot dataset ONLY.
//
// Config (env):
//   BQ_PROJECT            GCP project holding the datasets (default: GOOGLE_CLOUD_PROJECT)
//   WAREHOUSE_SOURCE_DATASET   read-only source dataset
//   BQ_SNAPSHOT_DATASET   app-owned dataset for snapshots       (default: "avc_risk_monitor")
//   BQ_LOCATION           dataset location                      (default: "US")

import { warehouse } from "@/config/app.config";

export interface BqConfig {
  project: string;
  feedsDataset: string;
  snapshotDataset: string;
  location: string;
}

let cachedConfig: BqConfig | null = null;

export function getBqConfig(): BqConfig {
  if (cachedConfig) return cachedConfig;
  // All values come from the single config file — never read env here.
  cachedConfig = {
    project: warehouse.project,
    feedsDataset: warehouse.sourceDataset,
    snapshotDataset: warehouse.snapshotDataset,
    location: warehouse.location,
  };
  return cachedConfig;
}

/** True when a project is configured; the UI degrades gracefully when not. */
export function bigQueryEnabled(): boolean {
  return warehouse.enabled && Boolean(getBqConfig().project);
}

type BigQueryClient = import("@google-cloud/bigquery").BigQuery;
let clientHandle: BigQueryClient | null = null;

async function client(): Promise<BigQueryClient> {
  if (!clientHandle) {
    const { BigQuery } = await import("@google-cloud/bigquery");
    const cfg = getBqConfig();
    clientHandle = new BigQuery({ projectId: cfg.project, location: cfg.location });
  }
  return clientHandle;
}

/**
 * Run a read-only parameterized query. Rejects anything that isn't a lone SELECT
 * or WITH — a defensive guard so this path can never mutate a source table, even
 * by mistake. (Snapshot writes go through `insertSnapshotRows`, not here.)
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  assertReadOnly(sql);
  const bq = await client();
  const [rows] = await bq.query({
    query: sql,
    params,
    location: getBqConfig().location,
  });
  return rows as T[];
}

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT)\b/i;

function assertReadOnly(sql: string): void {
  // Strip line and block comments so a commented keyword can't trip the guard,
  // and a real one can't hide behind a comment.
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
  const head = stripped.split(/\s+/, 1)[0]?.toUpperCase();
  if (head !== "SELECT" && head !== "WITH") {
    throw new Error(`Read-only query layer: only SELECT/WITH allowed, got "${head}".`);
  }
  if (FORBIDDEN.test(stripped)) {
    throw new Error("Read-only query layer: statement contains a write keyword.");
  }
}

/** Fully-qualified `project.dataset.table` for a source (read-only) table. */
export function feedsTable(name: string): string {
  const cfg = getBqConfig();
  return `\`${cfg.project}.${cfg.feedsDataset}.${name}\``;
}

/** Fully-qualified name for an app-owned snapshot table. */
export function snapshotTable(name: string): string {
  const cfg = getBqConfig();
  return `\`${cfg.project}.${cfg.snapshotDataset}.${name}\``;
}

/**
 * Append rows to an app-owned snapshot table, creating it (and the dataset) on
 * first use. This is the ONLY function in the app that writes to BigQuery, and it
 * targets only the app-owned snapshot dataset — never ${warehouse.sourceDataset}.
 */
export async function insertSnapshotRows(
  table: string,
  rows: Record<string, unknown>[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const cfg = getBqConfig();
  const bq = await client();

  const dataset = bq.dataset(cfg.snapshotDataset);
  const [dsExists] = await dataset.exists();
  if (!dsExists) await dataset.create({ location: cfg.location });

  const t = dataset.table(table);
  const [tExists] = await t.exists();
  if (!tExists) {
    // Infer a schema from the first row; snapshot rows are flat scalars + a date.
    const sample = rows[0];
    const fields = Object.entries(sample).map(([name, v]) => ({
      name,
      type:
        name.endsWith("_date") || name === "snapshot_date"
          ? "DATE"
          : typeof v === "number"
            ? "FLOAT64"
            : typeof v === "boolean"
              ? "BOOL"
              : "STRING",
    }));
    await dataset.createTable(table, {
      schema: { fields },
      location: cfg.location,
      timePartitioning: { type: "DAY", field: "snapshot_date" },
    });
  }

  await t.insert(rows);
  return rows.length;
}
