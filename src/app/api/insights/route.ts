import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/insights — Drags & Drivers for the Sales hub. */
export async function GET() {
  const agg = await readAggregate();
  if (!agg) return NextResponse.json({ empty: true, drivers: [], drags: [], currency: "USD", window: { start: "", end: "" } });
  return NextResponse.json({
    drivers: agg.drivers,
    drags: agg.drags,
    currency: agg.totals.sales.currency,
    window: { start: agg.meta.salesWindow.start, end: agg.meta.salesWindow.end },
  });
}
