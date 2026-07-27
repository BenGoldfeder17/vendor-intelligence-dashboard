// Portable JSON persistence.
//
// Every piece of app state (aggregate, sync status, reference table, cached
// report documents) is a single JSON document, so the store is a simple
// key → JSON map. Keys are plain names like "aggregate.json".
//
// Three interchangeable drivers, selected by STORAGE_DRIVER:
//
//   local — plain filesystem under STORAGE_LOCAL_DIR. Works on any VM, SSH
//           server, container with a mounted volume, or a laptop. The default.
//   s3    — any S3-compatible object store: AWS S3, MinIO, Cloudflare R2,
//           Wasabi, Ceph. Set STORAGE_BUCKET and (for non-AWS) S3_ENDPOINT.
//   gcs   — Google Cloud Storage. Set STORAGE_BUCKET.
//
// Cloud SDKs are dynamically imported, so a local deployment never loads the
// AWS or Google libraries, and an S3 deployment never loads the Google one.
//
// NOTE ON EPHEMERAL FILESYSTEMS: serverless/container platforms (Cloud Run, App
// Runner, Lambda, Fly machines) usually have a read-only or per-instance
// filesystem wiped on cold start. On those, use `s3` or `gcs`, or mount a
// persistent volume and point STORAGE_LOCAL_DIR at it.

import { promises as fs } from "node:fs";
import path from "node:path";
import { storage as storageConfig, type StorageDriver } from "@/config/app.config";

const DRIVER: StorageDriver = storageConfig.driver;
const BUCKET = storageConfig.bucket;
const PREFIX = storageConfig.prefix.replace(/^\/+|\/+$/g, "");
const LOCAL_DIR = path.isAbsolute(storageConfig.localDir)
  ? storageConfig.localDir
  : path.join(process.cwd(), storageConfig.localDir);

/** Which driver is actually in use — surfaced for diagnostics/health checks. */
export const storageBackend: StorageDriver = DRIVER;

function objectName(key: string): string {
  return PREFIX ? `${PREFIX}/${key}` : key;
}

// ── local ────────────────────────────────────────────────────────────────────

async function localRead<T>(key: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(LOCAL_DIR, key), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function localWrite(key: string, body: string): Promise<void> {
  const full = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, "utf-8");
}

async function localDelete(key: string): Promise<void> {
  try {
    await fs.unlink(path.join(LOCAL_DIR, key));
  } catch {
    /* already gone */
  }
}

// ── gcs ──────────────────────────────────────────────────────────────────────

let gcsHandle: import("@google-cloud/storage").Bucket | null = null;

async function gcsBucket(): Promise<import("@google-cloud/storage").Bucket> {
  if (!gcsHandle) {
    if (!BUCKET) throw new Error("STORAGE_DRIVER=gcs requires STORAGE_BUCKET.");
    const { Storage } = await import("@google-cloud/storage");
    // Credentials come from ADC: a runtime service account in-cloud, or
    // `gcloud auth application-default login` locally.
    gcsHandle = new Storage().bucket(BUCKET);
  }
  return gcsHandle;
}

async function gcsRead<T>(key: string): Promise<T | null> {
  try {
    const bucket = await gcsBucket();
    const [buf] = await bucket.file(objectName(key)).download();
    return JSON.parse(buf.toString("utf-8")) as T;
  } catch (err) {
    if ((err as { code?: number })?.code === 404) return null;
    throw err;
  }
}

async function gcsWrite(key: string, body: string): Promise<void> {
  const bucket = await gcsBucket();
  await bucket.file(objectName(key)).save(body, {
    resumable: false,
    metadata: { contentType: "application/json" },
  });
}

async function gcsDelete(key: string): Promise<void> {
  try {
    const bucket = await gcsBucket();
    await bucket.file(objectName(key)).delete({ ignoreNotFound: true });
  } catch {
    /* ignore */
  }
}

// ── s3 (and any S3-compatible store) ─────────────────────────────────────────

type S3ClientType = import("@aws-sdk/client-s3").S3Client;
let s3Handle: S3ClientType | null = null;

async function s3Client(): Promise<S3ClientType> {
  if (!s3Handle) {
    if (!BUCKET) throw new Error("STORAGE_DRIVER=s3 requires STORAGE_BUCKET.");
    const { S3Client } = await import("@aws-sdk/client-s3");
    // Credentials resolve from the default chain: env vars, shared config file,
    // or container/instance role. Nothing provider-specific is hardcoded.
    s3Handle = new S3Client({
      region: storageConfig.s3Region,
      ...(storageConfig.s3Endpoint ? { endpoint: storageConfig.s3Endpoint } : {}),
      ...(storageConfig.s3ForcePathStyle ? { forcePathStyle: true } : {}),
    });
  }
  return s3Handle;
}

async function s3Read<T>(key: string): Promise<T | null> {
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    const res = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: objectName(key) })
    );
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (name === "NoSuchKey" || name === "NotFound" || status === 404) return null;
    throw err;
  }
}

async function s3Write(key: string, body: string): Promise<void> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: objectName(key),
      Body: body,
      ContentType: "application/json",
    })
  );
}

async function s3Delete(key: string): Promise<void> {
  try {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objectName(key) }));
  } catch {
    /* ignore */
  }
}

// ── public API (identical across drivers) ────────────────────────────────────

/** Read a JSON document by key. Returns null if it doesn't exist. */
export async function readJson<T>(key: string): Promise<T | null> {
  switch (DRIVER) {
    case "gcs":
      return gcsRead<T>(key);
    case "s3":
      return s3Read<T>(key);
    default:
      return localRead<T>(key);
  }
}

/** Write a JSON document by key (overwrites). */
export async function writeJson(key: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  switch (DRIVER) {
    case "gcs":
      return gcsWrite(key, body);
    case "s3":
      return s3Write(key, body);
    default:
      return localWrite(key, body);
  }
}

/** Delete a JSON document by key. No-op if it's already gone. */
export async function deleteJson(key: string): Promise<void> {
  switch (DRIVER) {
    case "gcs":
      return gcsDelete(key);
    case "s3":
      return s3Delete(key);
    default:
      return localDelete(key);
  }
}

/** Lightweight round-trip health check for the configured store. */
export async function storageHealth(): Promise<{
  driver: StorageDriver;
  ok: boolean;
  detail: string;
}> {
  const probe = "__health.json";
  try {
    await writeJson(probe, { at: new Date().toISOString() });
    await readJson(probe);
    await deleteJson(probe);
    return {
      driver: DRIVER,
      ok: true,
      detail: DRIVER === "local" ? LOCAL_DIR : `${BUCKET}${PREFIX ? `/${PREFIX}` : ""}`,
    };
  } catch (e) {
    return { driver: DRIVER, ok: false, detail: (e as Error).message };
  }
}
