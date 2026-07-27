// Report-document cache.
//
// The sync bottleneck on a full refresh is NOT Amazon's report generation — it's
// that getReportsData re-downloads and re-parses every report document on every
// sync. A reportDocumentId points at IMMUTABLE content: when Amazon's data for a
// window changes, it issues a NEW document with a NEW id. So the id is a perfect
// cache key — if we've already fetched a given documentId, its parsed contents can
// be reused verbatim, and a changed report simply misses the cache (new id).
//
// This makes a 26-week full refresh cheap in the steady state: the settled weeks
// keep the same document ids run-to-run and are served from cache; only genuinely
// new or changed documents are downloaded. It CANNOT serve stale data — staleness
// would require Amazon to change a report's contents without changing its id,
// which doesn't happen.
//
// Storage: one small JSON per document under a cache prefix in GCS. Reads are also
// held in a per-instance memory map so repeated ids within a single sync don't
// even hit GCS.

import { readJson, writeJson } from "../storage";

const PREFIX = "report-cache/";
// Documents older than this are effectively permanent; we keep them but could
// prune. Amazon document ids are stable, so there's no correctness reason to expire.
const CACHE_VERSION = "v1";

interface CachedDoc {
  version: string;
  documentId: string;
  cachedAt: string;
  /** The parsed report document (JSON) or a { __raw } wrapper for non-JSON. */
  doc: unknown;
}

// Per-instance memory layer: id → parsed doc. Survives for the container lifetime.
const memCache = new Map<string, unknown>();

function keyFor(documentId: string): string {
  // Document ids can contain characters unsafe for object keys; hash-ish sanitize.
  const safe = documentId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${PREFIX}${CACHE_VERSION}/${safe}.json`;
}

/** Return a cached parsed document for this id, or null on miss. */
export async function getCachedReportDoc(documentId: string): Promise<unknown | null> {
  const mem = memCache.get(documentId);
  if (mem !== undefined) return mem;

  try {
    const cached = await readJson<CachedDoc>(keyFor(documentId));
    if (cached && cached.version === CACHE_VERSION) {
      memCache.set(documentId, cached.doc);
      return cached.doc;
    }
  } catch {
    /* miss → fall through */
  }
  return null;
}

/** Store a parsed document under its id. Fire-and-forget safe. */
export async function putCachedReportDoc(documentId: string, doc: unknown): Promise<void> {
  memCache.set(documentId, doc);
  try {
    await writeJson(keyFor(documentId), {
      version: CACHE_VERSION,
      documentId,
      cachedAt: new Date().toISOString(),
      doc,
    } satisfies CachedDoc);
  } catch {
    /* a cache write failure must never break a sync */
  }
}
