import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/forecast — forward demand forecast per ASIN. */
export async function GET() {
  const agg = await readAggregate();
  if (!agg) return NextResponse.json({ byAsin: [], meta: null });

  const byAsin = agg.products
    .filter((p) => p.forecast.length > 0)
    .map((p) => ({
      asin: p.asin,
      style10: p.style10,
      title: p.title,
      forecast: p.forecast,
    }));

  return NextResponse.json({ meta: agg.meta, byAsin });
}
