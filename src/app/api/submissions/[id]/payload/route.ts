import { NextResponse } from "next/server";
import { listSubmissions } from "@/lib/submissions";
import { getProductTypeSchema, buildAttributes, validateValues } from "@/lib/productTypes";
import { getConfig } from "@/lib/spapi/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/submissions/{id}/payload[?download=1]
 *
 * Returns the exact body the Listings Items API expects:
 *   PUT /listings/2021-08-01/items/{vendorCode}/{sku}
 *   { productType, requirements: "LISTING", attributes }
 *
 * Phase 2 sends this. Today it's the handoff artifact for item setup.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = (await listSubmissions()).find((s) => s.id === id);
  if (!sub) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const schema = await getProductTypeSchema(sub.productType);
    const cfg = getConfig();
    const payload = {
      productType: sub.productType,
      requirements: "LISTING",
      attributes: buildAttributes(schema.fields, sub.values, cfg.marketplaceId),
    };
    const errors = validateValues(schema.fields, sub.values);

    if (new URL(req.url).searchParams.get("download") === "1") {
      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sub.sku}-listing.json"`,
        },
      });
    }
    return NextResponse.json({ payload, errors, sku: sub.sku });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
