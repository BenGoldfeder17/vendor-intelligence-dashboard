import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sales — aggregated sales totals + per-ASIN summaries and series. */
export async function GET() {
  const agg = await readAggregate();
  if (!agg) return NextResponse.json({ totals: null, byAsin: [], meta: null });

  const byAsin = agg.products
    .filter((p) => p.sales)
    .map((p) => ({
      asin: p.asin,
      style10: p.style10,
      title: p.title,
      summary: p.sales,
      series: p.salesSeries,
    }));

  return NextResponse.json({ meta: agg.meta, totals: agg.totals, byAsin });
}
