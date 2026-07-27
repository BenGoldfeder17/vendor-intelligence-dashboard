import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";
import { readReference } from "@/lib/reference";
import { buildConfirmationReport } from "@/lib/confirmation";
import { readJson, writeJson } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TREND_KEY = "conf-trend.json";

interface TrendPoint {
  date: string;
  allRate: number | null;
  ownRate: number | null;
  brandedRate: number | null;
  ownRejected: number;
  brandedRejected: number;
  recoverableValue: number;
  unavailableAsins: number;
}

async function readTrend(): Promise<TrendPoint[]> {
  return (await readJson<TrendPoint[]>(TREND_KEY)) ?? [];
}
async function writeTrend(points: TrendPoint[]): Promise<void> {
  await writeJson(TREND_KEY, points);
}

/** GET /api/confirmation?months=N — code-aware report (windowed) + brand-split trend. */
export async function GET(req: Request) {
  const agg = await readAggregate();
  const ref = await readReference();
  if (!ref) return NextResponse.json({ needsReference: true });
  if (!agg) return NextResponse.json({ needsSync: true });

  const raw = new URL(req.url).searchParams.get("months");
  const months = raw && raw !== "all" ? Math.max(1, parseInt(raw, 10) || 0) || null : null;

  const now = new Date();
  const report = buildConfirmationReport(agg, ref, now.toISOString(), months);

  // The daily trend tracks the FULL window only (so the filter doesn't pollute it);
  // only write a snapshot on the unfiltered request.
  const trend = await readTrend();
  if (months == null) {
    const today = now.toISOString().slice(0, 10);
    const snapshot: TrendPoint = {
      date: today,
      allRate: report.segments.ALL.confirmationRate,
      ownRate: report.segments.OWN.confirmationRate,
      brandedRate: report.segments.OTHER.confirmationRate,
      ownRejected: report.segments.OWN.rejected,
      brandedRejected: report.segments.OTHER.rejected,
      recoverableValue: report.segments.ALL.buckets.recoverable.rejectedValue,
      unavailableAsins: report.segments.ALL.buckets.unavailable.asins,
    };
    if (trend.length && trend[trend.length - 1].date === today) trend[trend.length - 1] = snapshot;
    else trend.push(snapshot);
    await writeTrend(trend);
  }

  // Cap the per-list payload; full lists are available via CSV export.
  return NextResponse.json({
    ...report,
    recoverable: report.recoverable.slice(0, 1000),
    unavailable: report.unavailable.slice(0, 1000),
    recoverableTotal: report.recoverable.length,
    unavailableTotal: report.unavailable.length,
    trend,
  });
}
