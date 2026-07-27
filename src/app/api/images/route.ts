import { NextResponse } from "next/server";
import {
  storeImage,
  imageMode,
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
} from "@/lib/imageStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/images — which upload mode is active. */
export async function GET() {
  return NextResponse.json({
    mode: imageMode,
    canUpload: imageMode !== "off",
    amazonReachable: imageMode === "public",
  });
}

/** POST /api/images — multipart (file, sku) → { url }. */
export async function POST(req: Request) {
  if (imageMode === "off") {
    return NextResponse.json(
      { error: "No storage bucket is configured, so uploads are off. Paste an image URL instead." },
      { status: 501 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file received." }, { status: 400 });
  }
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return NextResponse.json(
      { error: `Use JPEG, PNG, GIF or TIFF — that file is ${file.type || "an unknown type"}.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: `${file.name} is over 10 MB.` }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await storeImage(String(form.get("sku") ?? ""), file.name, buf, file.type);

    if (stored.mode === "public" && stored.publicUrl) {
      return NextResponse.json({ url: stored.publicUrl, amazonReachable: true });
    }

    // Proxy mode: serve it back through this app, on an absolute URL.
    const origin = new URL(req.url).origin;
    return NextResponse.json({
      url: `${origin}/api/images/file?key=${encodeURIComponent(stored.key!)}`,
      amazonReachable: false,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
