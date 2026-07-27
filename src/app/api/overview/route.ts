import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";
import { buildOverview } from "@/lib/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/overview?months=N — portfolio aggregations; PO block is windowed. */
export async function GET(req: Request) {
  const agg = await readAggregate();
  if (!agg) {
    return NextResponse.json({ empty: true });
  }
  const raw = new URL(req.url).searchParams.get("months");
  const months = raw && raw !== "all" ? Math.max(1, parseInt(raw, 10) || 0) || null : null;
  return NextResponse.json(buildOverview(agg, months));
}
