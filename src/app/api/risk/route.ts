import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";
import { readAraNetPpm } from "@/lib/araNetPpm";
import {
  floorGauge,
  brandCodeConcentration,
  repriceTargets,
  dataQuality,
  suppressionLedger,
  fillRisk,
  styleRevenueFromMap,
} from "@/lib/riskMonitor";
import { bigQueryEnabled } from "@/lib/bigquery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/risk — Panels 1-6. All reads. */
export async function GET() {
  const ara = await readAraNetPpm();
  const agg = await readAggregate();

  // Per-ASIN shipped revenue from the aggregate (built once, reused below).
  const asinRevenue = new Map<string, number>();
  let orderedUnits = 0;
  let shippedUnits = 0;
  for (const p of agg?.products ?? []) {
    if (p.sales) {
      asinRevenue.set(p.asin.toUpperCase(), p.sales.shippedRevenue);
      orderedUnits += p.sales.orderedUnits;
      shippedUnits += p.sales.shippedUnits;
    }
  }

  // Sourcing Net PPM exports have no revenue column, so the floor gauge (which is
  // revenue-weighted) needs revenue joined in by ASIN from the synced sales data.
  const araRows = (ara?.rows ?? []).map((r) =>
    r.shippedRevenue != null
      ? r
      : { ...r, shippedRevenue: asinRevenue.get(r.asin.toUpperCase()) ?? null }
  );
  const margin = araRows.length
    ? {
        floor: floorGauge(araRows),
        brandCodes: brandCodeConcentration(araRows),
        reprice: repriceTargets(araRows),
        quality: dataQuality(araRows),
      }
    : null;

  const gapPct = orderedUnits > 0 ? ((orderedUnits - shippedUnits) / orderedUnits) * 100 : null;

  const styleRevenue = await styleRevenueFromMap(asinRevenue);
  const [suppression, fill] = await Promise.all([
    suppressionLedger(styleRevenue),
    fillRisk(gapPct),
  ]);

  // ── Aggregated risk summary: one synthesized posture across every panel, so
  //    the page opens with the whole picture instead of a wall of tables. ──
  const belowFloorRevenue = margin?.reprice.revenue ?? 0;
  const codesAtRisk = margin?.brandCodes.filter((b) => b.status === "red").length ?? 0;
  const totalCodes = margin?.brandCodes.length ?? 0;
  const marginSuppression = suppression.available ? suppression.marginRevenue : null;
  const floorStatus = margin?.floor.status ?? null;

  // A single 0-100 "risk index" is deliberately NOT invented (false precision).
  // Instead: a headline posture + the few numbers that actually drive decisions.
  const posture: "healthy" | "watch" | "at_risk" =
    floorStatus === "red" || codesAtRisk > 0
      ? "at_risk"
      : floorStatus === "amber" || belowFloorRevenue > 0
        ? "watch"
        : "healthy";

  const summary = {
    posture,
    blendedNetPpm: margin?.floor.blendedNetPpm ?? null,
    floorHeadroomPts: margin?.floor.headroomPts ?? null,
    floorStatus,
    belowFloorCount: margin?.reprice.count ?? 0,
    belowFloorRevenue,
    codesAtRisk,
    totalCodes,
    marginSuppressionRevenue: marginSuppression,
    fillGapPct: gapPct,
    brokenTailAsins: margin?.quality.brokenTailAsins ?? 0,
    // The single worst brand code, surfaced up top.
    worstCode: margin?.brandCodes[0]
      ? {
          code: margin.brandCodes[0].brandCode,
          netPpm: margin.brandCodes[0].netPpm,
          headroomPts: margin.brandCodes[0].headroomPts,
          revenue: margin.brandCodes[0].revenue,
        }
      : null,
  };

  return NextResponse.json({
    bigQueryEnabled: bigQueryEnabled(),
    hasAra: araRows.length > 0,
    hasAggregate: Boolean(agg),
    summary,
    margin,
    suppression,
    fill,
    araMeta: ara?.meta ?? null,
  });
}
