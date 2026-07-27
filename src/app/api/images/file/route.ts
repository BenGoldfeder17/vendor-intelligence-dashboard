import { readImage } from "@/lib/imageStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/images/file?key=listing-images/... — serves an uploaded image. */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return new Response("key is required", { status: 400 });

  const img = await readImage(key);
  if (!img) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(img.body), {
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
