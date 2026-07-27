import { NextResponse } from "next/server";
import { startNetPpmPull, checkNetPpmPull } from "@/lib/netPpmPull";
import { isConfigured } from "@/lib/spapi/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/net-ppm/pull — START a Net PPM pull. Returns immediately with a
 * queryId; does NOT wait for Amazon (that caused the timeout). Poll GET to see
 * when it lands.
 */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "SP-API credentials aren't configured." }, { status: 501 });
  }
  const q = new URL(req.url).searchParams;
  const start = q.get("start") ?? undefined;
  const end = q.get("end") ?? undefined;

  try {
    const res = await startNetPpmPull(start, end);
    if (res.error) return NextResponse.json({ error: res.error }, { status: 502 });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/**
 * GET /api/net-ppm/pull — CHECK a pending pull. Collects + stores results if
 * Amazon has finished; otherwise reports "pending". Cheap; safe to poll.
 */
export async function GET() {
  try {
    const res = await checkNetPpmPull();
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ state: "failed", error: (e as Error).message }, { status: 502 });
  }
}
