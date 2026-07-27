import { NextResponse } from "next/server";
import { getProductTypeSchema } from "@/lib/productTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/product-types/PROTECTIVE_GLOVE[?refresh=1] — normalized form schema. */
export async function GET(req: Request, { params }: { params: Promise<{ productType: string }> }) {
  const { productType } = await params;
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    return NextResponse.json(await getProductTypeSchema(productType, force));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
