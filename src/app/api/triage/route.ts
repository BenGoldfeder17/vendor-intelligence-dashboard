import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";
import { readReference } from "@/lib/reference";
import { readAraNetPpm } from "@/lib/araNetPpm";
import { buildTriageFeed } from "@/lib/triage";
import { refreshContracts } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/triage — the command center's ranked signal feed. All reads. */
export async function GET() {
  // Load vendor contracts before any margin computation.
  await refreshContracts();
  const [agg, ref, ara] = await Promise.all([
    readAggregate(),
    readReference(),
    readAraNetPpm(),
  ]);
  return NextResponse.json(await buildTriageFeed(agg, ref, ara));
}
