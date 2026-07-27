import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";
import { publicAsinImage } from "@/lib/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/products — slim product list for the dashboard grid.
 * Heavy fields (full attributes, A+ blocks, long series) are omitted here;
 * the detail page reads the full record.
 */
export async function GET() {
  const agg = await readAggregate();
  if (!agg) {
    return NextResponse.json({ meta: null, products: [] });
  }

  const products = agg.products.map((p) => ({
    asin: p.asin,
    style: p.style,
    style10: p.style10,
    title: p.title,
    brand: p.brand,
    thumbnail:
      p.images.find((i) => i.variant === "MAIN")?.link ?? p.images[0]?.link ?? publicAsinImage(p.asin, 400),
    productType: p.productType,
    salesRank: p.salesRank,
    hasAplus: p.aplus.length > 0,
    shippedRevenue: p.sales?.shippedRevenue ?? 0,
    shippedUnits: p.sales?.shippedUnits ?? 0,
    currency: p.sales?.currency ?? agg.totals.sales.currency,
    listPrice: p.vendor?.listPrice ?? null,
    netCost: p.vendor?.netCost ?? null,
    poUnits: p.vendor?.orderedUnits ?? null,
    returns: p.sales?.customerReturns ?? 0,
    insightKind: p.insight?.kind ?? null,
    deltaPct: p.insight?.deltaPct ?? null,
  }));

  return NextResponse.json({ meta: agg.meta, totals: agg.totals, products });
}
