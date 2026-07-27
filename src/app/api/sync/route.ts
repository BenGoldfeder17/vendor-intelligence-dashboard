import { NextResponse } from "next/server";
import { startSync, getSyncStatus } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sync — current sync status (for polling). */
export async function GET() {
  return NextResponse.json(await getSyncStatus());
}

/** POST /api/sync — start a background sync (no-op if one is running). */
export async function POST() {
  const result = startSync();
  return NextResponse.json(result, { status: result.started ? 202 : 200 });
}
