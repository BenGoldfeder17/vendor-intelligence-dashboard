import { NextResponse } from "next/server";
import { listAllProductTypes, searchProductTypes } from "@/lib/productTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/product-types            → every product type Amazon offers (cached)
 * GET /api/product-types?q=glove    → Amazon's own keyword search
 * GET /api/product-types?refresh=1  → bust the cache
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    const productTypes = q
      ? await searchProductTypes(q)
      : await listAllProductTypes(refresh);
    return NextResponse.json({ productTypes, total: productTypes.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
