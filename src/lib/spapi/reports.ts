// Reports API (2021-06-30) driver.
//
// Primary path: REUSE the most recent already-DONE reports of a type. Amazon
// continuously generates vendor analytics/forecast reports, so listing + reading
// existing documents is reliable, fast, and avoids the heavily-throttled (and,
// right after a role grant, intermittently 403-ing) createReport operation.
//
// Fallback path: if no DONE report exists, create one and poll it to completion.

import { gunzipSync } from "node:zlib";
import { getConfig } from "./config";
import { request, sleep, SpapiError } from "./client";
import { getCachedReportDoc, putCachedReportDoc } from "./reportCache";

const REPORTS_BASE = "/reports/2021-06-30";

interface ReportMeta {
  reportId: string;
  reportType: string;
  processingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL";
  reportDocumentId?: string;
  dataStartTime?: string;
  dataEndTime?: string;
  createdTime?: string;
}

interface ListReportsResponse {
  reports?: ReportMeta[];
  nextToken?: string;
}

interface CreateReportResponse {
  reportId: string;
}

interface ReportDocument {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: "GZIP";
}

export interface CreateReportInput {
  reportType: string;
  marketplaceIds?: string[];
  dataStartTime?: string;
  dataEndTime?: string;
  reportOptions?: Record<string, string>;
}

/** Lists DONE reports of a type that have a downloadable document, newest first. */
export async function listDoneReports(reportType: string, pageSize = 10): Promise<ReportMeta[]> {
  const cfg = getConfig();
  const res = await request<ListReportsResponse>({
    path: `${REPORTS_BASE}/reports`,
    query: {
      reportTypes: reportType,
      processingStatuses: "DONE",
      marketplaceIds: cfg.marketplaceId,
      pageSize: Math.min(100, Math.max(1, pageSize)),
    },
  });
  const reports = (res.reports ?? []).filter((r) => r.reportDocumentId);
  // Newest first by data window, then creation time.
  reports.sort((a, b) => {
    const da = (b.dataEndTime ?? b.createdTime ?? "").localeCompare(a.dataEndTime ?? a.createdTime ?? "");
    return da !== 0 ? da : (b.createdTime ?? "").localeCompare(a.createdTime ?? "");
  });
  return reports;
}

/** Downloads + decompresses + parses a report document by id. */
export async function fetchReportDocument(reportDocumentId: string): Promise<unknown> {
  // The document id is immutable — a changed report gets a new id — so a cache
  // hit here is always correct. This is the main sync speedup: settled weeks keep
  // their ids run-to-run and skip the download+gunzip+parse entirely.
  const cached = await getCachedReportDoc(reportDocumentId);
  if (cached !== null) return cached;

  const doc = await request<ReportDocument>({
    path: `${REPORTS_BASE}/documents/${reportDocumentId}`,
  });
  const dl = await fetch(doc.url, { cache: "no-store" });
  if (!dl.ok) throw new SpapiError(`Failed to download report document (${dl.status})`, dl.status, doc.url);
  const buf = Buffer.from(await dl.arrayBuffer());
  const raw = doc.compressionAlgorithm === "GZIP" ? gunzipSync(buf).toString("utf-8") : buf.toString("utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { __raw: raw };
  }
  // Cache for future syncs (fire-and-forget; a cache write can't break the sync).
  void putCachedReportDoc(reportDocumentId, parsed);
  return parsed;
}

/**
 * Returns parsed documents for a report type: the most recent `maxReports` DONE
 * reports (newest first). Falls back to creating one if none exist. Each fetch
 * is independent — a single failed document is skipped rather than fatal.
 *
 * `minWeeksWanted`: when set, if reuse of existing reports yields fewer distinct
 * weekly windows than this, we ALSO create a fresh report for the full
 * dataStartTime..dataEndTime range and merge it in. This is the fix for Amazon
 * retaining only ~12 recent weekly reports when you need more — a single fresh
 * report over a 180-day window returns every week in one document.
 */
export async function getReportsData(
  input: CreateReportInput,
  maxReports: number,
  onProgress?: (msg: string) => void,
  minWeeksWanted?: number
): Promise<unknown[]> {
  const log = (m: string) => onProgress?.(m);

  let done: ReportMeta[] = [];
  try {
    done = await listDoneReports(input.reportType, Math.max(maxReports, 10));
  } catch (e) {
    log(`Could not list existing ${input.reportType} reports: ${msg(e)}`);
  }

  const docs: unknown[] = [];

  if (done.length) {
    const take = done.slice(0, maxReports);
    let cachedCount = 0;
    for (const r of take) {
      if ((await getCachedReportDoc(r.reportDocumentId!)) !== null) cachedCount += 1;
    }
    log(
      `Reusing ${take.length} ${input.reportType} report(s) (of ${done.length}); ` +
        `${cachedCount} from cache, ${take.length - cachedCount} to download.`
    );
    for (const r of take) {
      try {
        docs.push(await fetchReportDocument(r.reportDocumentId!));
      } catch (e) {
        log(`Skipped one ${input.reportType} document: ${msg(e)}`);
      }
    }
  }

  // If reuse didn't cover the window we need, create a fresh report for the full
  // range. Amazon returns every period in the window in one document, so this
  // fills the gap between "what Amazon kept" and "what we asked for".
  const distinctWeeks = countDistinctWindows(docs);
  const needFresh =
    docs.length === 0 ||
    (minWeeksWanted != null && distinctWeeks < minWeeksWanted && input.dataStartTime != null);

  if (needFresh) {
    if (docs.length > 0) {
      log(
        `Only ${distinctWeeks} week(s) available by reuse; requesting a fresh ` +
          `${input.reportType} for the full window (this is the slow path)…`
      );
    } else {
      log(`No reusable ${input.reportType} report; creating a new one…`);
    }
    try {
      const fresh = await createAndPoll(input, onProgress);
      if (fresh) docs.push(fresh);
    } catch (e) {
      log(`Fresh ${input.reportType} report failed: ${msg(e)}`);
    }
  }

  return docs;
}

/**
 * Count distinct period windows present across report documents, so we can tell
 * whether reuse actually covered the requested span. Looks for the common
 * shapes: salesByAsin[].startDate, or a top-level reportPeriod window.
 */
function countDistinctWindows(docs: unknown[]): number {
  const weeks = new Set<string>();
  for (const doc of docs) {
    const d = doc as Record<string, unknown>;
    const rows = (d?.salesByAsin ?? d?.forecastByAsin ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const start = (r?.startDate as string) ?? "";
      if (start) weeks.add(start.slice(0, 10));
    }
  }
  return weeks.size;
}

/** Create a report and poll to completion. Used only as a fallback. */
async function createAndPoll(input: CreateReportInput, onProgress?: (msg: string) => void): Promise<unknown> {
  const cfg = getConfig();
  const log = (m: string) => onProgress?.(m);

  const created = await request<CreateReportResponse>({
    method: "POST",
    path: `${REPORTS_BASE}/reports`,
    body: {
      reportType: input.reportType,
      marketplaceIds: input.marketplaceIds ?? [cfg.marketplaceId],
      dataStartTime: input.dataStartTime,
      dataEndTime: input.dataEndTime,
      reportOptions: input.reportOptions,
    },
  });

  const reportId = created.reportId;
  const deadline = Date.now() + 5 * 60_000;
  let delay = 3000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await request<ReportMeta>({ path: `${REPORTS_BASE}/reports/${reportId}` });
    if (status.processingStatus === "DONE" && status.reportDocumentId) {
      return fetchReportDocument(status.reportDocumentId);
    }
    if (status.processingStatus === "CANCELLED") {
      log(`Report ${input.reportType} CANCELLED (often = no data).`);
      return null;
    }
    if (status.processingStatus === "FATAL") {
      throw new SpapiError(`Report ${input.reportType} failed (FATAL)`, 500, reportId);
    }
    if (Date.now() > deadline) throw new SpapiError(`Report ${input.reportType} timed out`, 504, reportId);
    log(`Report ${input.reportType}: ${status.processingStatus}…`);
    await sleep(delay);
    delay = Math.min(delay * 1.5, 20_000);
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
