// Image hosting for listing submissions.
//
// Two modes, picked automatically from config:
//
//   "public"  PUBLIC_IMAGE_BUCKET is set (public-read). Returns a real public
//             URL — the only mode the marketplace can actually fetch from.
//   "proxy"   No image bucket, but an object-store bucket exists. The file is
//             stored privately and served back through /api/images/file.
//             Uploads and previews work with no setup, but the URL sits behind
//             your auth layer, so the marketplace can't reach it — fine for
//             drafting, not for a real submission. The UI says so.
//   "off"     No buckets at all (local dev) — paste URLs instead.

import { storage } from "@/config/app.config";

const IMAGE_BUCKET = storage.publicImageBucket;
const DATA_BUCKET = storage.bucket;

export type ImageMode = "public" | "proxy" | "off";

export const imageMode: ImageMode = IMAGE_BUCKET ? "public" : DATA_BUCKET ? "proxy" : "off";

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/tiff",
  "image/webp",
] as const;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function slug(s: string, fallback: string): string {
  const c = s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return c || fallback;
}

async function bucketFor(name: string) {
  const { Storage } = await import("@google-cloud/storage");
  return new Storage().bucket(name);
}

export interface StoredImage {
  mode: ImageMode;
  /** Set in "public" mode — a URL Amazon can fetch. */
  publicUrl?: string;
  /** Set in "proxy" mode — the object key, served via /api/images/file. */
  key?: string;
}

export async function storeImage(
  sku: string,
  filename: string,
  body: Buffer,
  contentType: string
): Promise<StoredImage> {
  const objectName = `listing-images/${slug(sku, "unassigned")}/${Date.now()}-${slug(
    filename,
    "image"
  )}`;

  if (imageMode === "public") {
    const bucket = await bucketFor(IMAGE_BUCKET);
    await bucket.file(objectName).save(body, {
      resumable: false,
      metadata: { contentType, cacheControl: "public, max-age=31536000" },
    });
    return {
      mode: "public",
      publicUrl: `https://storage.googleapis.com/${IMAGE_BUCKET}/${objectName}`,
    };
  }

  if (imageMode === "proxy") {
    const bucket = await bucketFor(DATA_BUCKET);
    await bucket.file(objectName).save(body, {
      resumable: false,
      metadata: { contentType },
    });
    return { mode: "proxy", key: objectName };
  }

  throw new Error("No storage bucket configured for images.");
}

/** Read an image back out (proxy mode serving). */
export async function readImage(
  key: string
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!DATA_BUCKET) return null;
  if (!key.startsWith("listing-images/")) return null; // don't serve arbitrary objects

  try {
    const bucket = await bucketFor(DATA_BUCKET);
    const file = bucket.file(key);
    const [meta] = await file.getMetadata();
    const [body] = await file.download();
    return { body, contentType: String(meta.contentType || "application/octet-stream") };
  } catch {
    return null;
  }
}
