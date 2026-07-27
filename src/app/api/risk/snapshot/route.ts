import { NextResponse } from "next/server";
import { runSnapshot } from "@/lib/riskSnapshot";
import { bigQueryEnabled } from "@/lib/bigquery";
import { security } from "@/config/app.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/risk/snapshot — capture this week's suppression + replenishment state.
 *
 * Meant to run weekly (Cloud Scheduler → this endpoint). It's the ONLY risk route
 * that writes anything, and it writes only to the app-owned snapshot dataset.
 *
 * Protected by SNAPSHOT_TOKEN when set: caller must send it as a Bearer token or
 * ?token=. If your platform already gates the service (IAP, ALB auth, VPN), the
 * token lets a scheduler call it without a browser session, and stops an
 * authenticated human from firing writes by accident.
 */
export async function POST(req: Request) {
  if (!bigQueryEnabled()) {
    return NextResponse.json(
      { error: "BigQuery isn't configured. Set BQ_PROJECT to enable the risk monitor." },
      { status: 501 }
    );
  }

  const expected = security.snapshotToken;
  if (expected) {
    const auth = req.headers.get("authorization") || "";
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const qToken = new URL(req.url).searchParams.get("token") || "";
    if (bearer !== expected && qToken !== expected) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  try {
    const result = await runSnapshot();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** GET — dry status only; never writes. */
export async function GET() {
  return NextResponse.json({
    enabled: bigQueryEnabled(),
    hint: "POST to run a snapshot. Schedule weekly via Cloud Scheduler.",
  });
}
