// Data Kiosk client (SP-API, v2023-11-15).
//
// This is the API path that replaces the manual ARA Net PPM CSV upload. The
// classic Reports API (GET_VENDOR_*) does NOT expose Net PPM; Data Kiosk's
// GraphQL vendor-analytics dataset does — netPPM, shippedCogs, contraCogs,
// salesDiscount, grouped by asin + brandCode, in Sourcing view.
//
// Requires the Brand Analytics role (confirmed granted). Each field in a Data
// Kiosk query is role-gated, so a missing role fails at createQuery, surfaced
// clearly rather than as a raw 400.
//
// Lifecycle (all confirmed against Amazon's docs):
//   1. createQuery   POST /dataKiosk/2023-11-15/queries      → queryId
//   2. getQuery      GET  .../queries/{queryId}              → processingStatus
//                    IN_QUEUE → IN_PROGRESS → DONE | FATAL | CANCELLED
//   3. getDocument   GET  .../documents/{dataDocumentId}     → presigned URL (5-min TTL)
//   4. download      fetch(documentUrl) → JSONL (one JSON object per line)
//      pagination: pagination.nextToken when size limits are exceeded.
//
// Concurrency: Amazon allows ONE non-terminal query per (query, partner, app).
// We poll to a terminal state before returning, so a subsequent call is safe.

import { request, SpapiError } from "./client";

const DK_BASE = "/dataKiosk/2023-11-15";

export interface CreateQueryResponse {
  queryId: string;
}

export interface QueryStatus {
  queryId: string;
  processingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "FATAL" | "CANCELLED";
  dataDocumentId?: string;
  errorDocumentId?: string;
  query?: string;
  pagination?: { nextToken?: string };
}

interface GetDocumentResponse {
  documentId: string;
  documentUrl: string;
  /** Present when the document is compressed (differs from Reports API). */
  compressionAlgorithm?: "GZIP";
}

/** Submit a GraphQL query. Body is the query as a string (≤8000 chars, trimmed). */
export async function createQuery(graphql: string): Promise<string> {
  const compact = graphql.replace(/\s+/g, " ").trim();
  if (compact.length > 8000) {
    throw new Error(`Data Kiosk query is ${compact.length} chars; the limit is 8000.`);
  }
  const res = await request<CreateQueryResponse>({
    method: "POST",
    path: `${DK_BASE}/queries`,
    body: { query: compact },
  });
  return res.queryId;
}

export async function getQuery(queryId: string): Promise<QueryStatus> {
  return request<QueryStatus>({ path: `${DK_BASE}/queries/${encodeURIComponent(queryId)}` });
}

async function getDocument(documentId: string): Promise<GetDocumentResponse> {
  return request<GetDocumentResponse>({
    path: `${DK_BASE}/documents/${encodeURIComponent(documentId)}`,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunQueryResult {
  status: QueryStatus["processingStatus"];
  /** Parsed JSONL rows across all pages. Empty when DONE-with-no-data. */
  rows: Record<string, unknown>[];
  /** Populated when the query ended FATAL — the error document's contents. */
  error?: string;
  /** First ~2KB of raw JSONL, for diagnosing an unexpected shape. */
  rawSample?: string;
}

/**
 * Submit a query and return its id immediately — does NOT wait for completion.
 * This is the key to not timing out: Data Kiosk queries can take many minutes,
 * which is far longer than an HTTP request should stay open. The caller stores
 * the id and later calls `collectIfReady` to fetch results once Amazon finishes.
 */
export async function submitQuery(graphql: string): Promise<string> {
  try {
    return await createQuery(graphql);
  } catch (e) {
    if (e instanceof SpapiError && e.status === 403) {
      throw new Error(
        "Data Kiosk returned 403 — the app is missing a role required by a field in this query " +
          "(Brand Analytics for vendor analytics). Confirm the role is granted and re-authorized."
      );
    }
    if (e instanceof SpapiError && e.status === 429) {
      throw new Error(
        "A Data Kiosk query for this dataset is already running. Wait for it to finish before re-requesting."
      );
    }
    throw e;
  }
}

export type CollectState = "pending" | "done" | "empty" | "failed" | "cancelled";

export interface CollectResult {
  state: CollectState;
  /** processingStatus straight from Amazon, for display. */
  processingStatus: QueryStatus["processingStatus"];
  rows: Record<string, unknown>[];
  rawSample?: string;
  error?: string;
}

/**
 * Check a submitted query ONCE. If Amazon is still processing, returns "pending"
 * with no work done — cheap, safe to call repeatedly on a schedule or from a
 * status poll. If it's DONE, fetches and parses the document(s) inline (that part
 * is fast — the slow bit was Amazon's processing, which has already finished).
 */
export async function collectIfReady(queryId: string): Promise<CollectResult> {
  const status = await getQuery(queryId);

  if (
    status.processingStatus === "IN_QUEUE" ||
    status.processingStatus === "IN_PROGRESS"
  ) {
    return { state: "pending", processingStatus: status.processingStatus, rows: [] };
  }

  if (status.processingStatus === "CANCELLED") {
    return { state: "cancelled", processingStatus: "CANCELLED", rows: [] };
  }

  if (status.processingStatus === "FATAL") {
    let error = "Query failed (FATAL).";
    if (status.errorDocumentId) {
      try {
        const doc = await getDocument(status.errorDocumentId);
        error = await downloadText(doc.documentUrl);
      } catch {
        /* keep generic */
      }
    }
    return { state: "failed", processingStatus: "FATAL", rows: [], error };
  }

  // DONE. No data document → completed with no data for the range.
  if (!status.dataDocumentId) {
    return { state: "empty", processingStatus: "DONE", rows: [] };
  }

  // Fetch + parse (fast — Amazon already did the slow work). Follow pagination.
  const rows: Record<string, unknown>[] = [];
  let rawSample: string | undefined;
  let cursor: QueryStatus | null = status;
  let guard = 0;
  while (cursor !== null && cursor.dataDocumentId && guard < 50) {
    const doc = await getDocument(cursor.dataDocumentId);
    const text = await downloadText(doc.documentUrl);
    if (rawSample === undefined) rawSample = text.slice(0, 2000);
    rows.push(...parseJsonl(text));

    const nextToken: string | undefined = cursor.pagination?.nextToken;
    if (!nextToken) {
      cursor = null;
      break;
    }
    cursor = await request<QueryStatus>({
      path: `${DK_BASE}/queries/${encodeURIComponent(queryId)}`,
      query: { paginationToken: nextToken },
    });
    guard += 1;
  }

  return { state: "done", processingStatus: "DONE", rows, rawSample };
}

/**
 * Run a query end to end: create → poll → fetch document(s) → parse JSONL,
 * following pagination. Polls with backoff up to `maxWaitMs`.
 *
 * Amazon recommends notifications over polling, but that needs EventBridge/SQS
 * wiring this app doesn't have. Polling is fully supported; we keep the interval
 * modest and cap total wait so a stuck query can't hang a request forever.
 */
export async function runQuery(
  graphql: string,
  opts: { maxWaitMs?: number; pollMs?: number } = {}
): Promise<RunQueryResult> {
  const maxWait = opts.maxWaitMs ?? 5 * 60_000; // 5 min default
  const pollMs = opts.pollMs ?? 5_000;

  let queryId: string;
  try {
    queryId = await createQuery(graphql);
  } catch (e) {
    if (e instanceof SpapiError && e.status === 403) {
      throw new Error(
        "Data Kiosk returned 403 — the app is missing a role required by a field in this query " +
          "(Brand Analytics for vendor analytics). Confirm the role is granted and re-authorized."
      );
    }
    if (e instanceof SpapiError && e.status === 429) {
      throw new Error(
        "A Data Kiosk query for this dataset is already running. Wait for it to finish before re-requesting."
      );
    }
    throw e;
  }

  const deadline = Date.now() + maxWait;
  let status: QueryStatus;
  // Poll until terminal or timeout.
  for (;;) {
    status = await getQuery(queryId);
    if (
      status.processingStatus === "DONE" ||
      status.processingStatus === "FATAL" ||
      status.processingStatus === "CANCELLED"
    ) {
      break;
    }
    if (Date.now() > deadline) {
      return { status: status.processingStatus, rows: [], error: "Timed out waiting for Data Kiosk." };
    }
    await sleep(pollMs);
  }

  if (status.processingStatus === "CANCELLED") {
    return { status: "CANCELLED", rows: [] };
  }

  if (status.processingStatus === "FATAL") {
    // The error document (if any) explains why.
    let error = "Query failed (FATAL).";
    if (status.errorDocumentId) {
      try {
        const doc = await getDocument(status.errorDocumentId);
        error = await downloadText(doc.documentUrl);
      } catch {
        /* keep generic message */
      }
    }
    return { status: "FATAL", rows: [], error };
  }

  // DONE. No dataDocumentId → completed with no data for the range.
  if (!status.dataDocumentId) {
    return { status: "DONE", rows: [] };
  }

  // Fetch this page, then follow pagination.nextToken across further pages.
  const rows: Record<string, unknown>[] = [];
  let rawSample: string | undefined;
  let cursor: QueryStatus | null = status;
  let guard = 0;
  while (cursor !== null && cursor.dataDocumentId && guard < 50) {
    const doc = await getDocument(cursor.dataDocumentId);
    const text = await downloadText(doc.documentUrl);
    if (rawSample === undefined) rawSample = text.slice(0, 2000);
    rows.push(...parseJsonl(text));

    const nextToken: string | undefined = cursor.pagination?.nextToken;
    if (!nextToken) {
      cursor = null;
      break;
    }
    // Next page: same queryId, paginationToken carries the cursor.
    cursor = await request<QueryStatus>({
      path: `${DK_BASE}/queries/${encodeURIComponent(queryId)}`,
      query: { paginationToken: nextToken },
    });
    guard += 1;
  }

  return { status: "DONE", rows, rawSample };
}

/** Fetch a presigned document URL as text. Not an SP-API path — plain GET. */
async function downloadText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Data Kiosk document download failed (${res.status}).`);
  }
  // fetch transparently gunzips when Content-Encoding is set.
  return res.text();
}

/** Parse JSONL (one JSON object per non-empty line), skipping malformed lines. */
export function parseJsonl(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip a malformed line rather than fail the whole pull */
    }
  }
  return out;
}
