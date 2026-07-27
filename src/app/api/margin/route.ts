import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";
import { readReference } from "@/lib/reference";
import { buildCrapReport } from "@/lib/crap";
import { refreshContracts } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/margin?weeks=8&benchmark=0.35&decay=-0.3 — silent-CRaP detector. */
export async function GET(req: Request) {
  // Load vendor contracts before any margin computation.
  await refreshContracts();
  const agg = await readAggregate();
  if (!agg) return NextResponse.json({ needsSync: true });

  const ref = await readReference();
  const q = new URL(req.url).searchParams;

  const num = (k: string, d: number) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) ? v : d;
  };

  const report = buildCrapReport(agg, ref, {
    weeks: Math.max(1, Math.round(num("weeks", 8))),
    benchmark: num("benchmark", 0.35),
    decayThreshold: num("decay", -0.3),
  });

  return NextResponse.json({
    ...report,
    rows: report.rows.slice(0, 500),
    rowTotal: report.rows.length,
  });
}
