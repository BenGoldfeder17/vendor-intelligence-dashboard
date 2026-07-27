import { NextResponse } from "next/server";
import {
  readStoredContracts,
  saveContracts,
  validateContracts,
  contractSource,
  CONTRACT_FIELDS,
} from "@/lib/contracts";
import { contracts as configContracts } from "@/config/app.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contracts — current contracts, their source, and the field schema. */
export async function GET() {
  const stored = await readStoredContracts();
  const source = await contractSource();

  const byVendorCode =
    stored && Object.keys(stored.byVendorCode).length > 0
      ? stored.byVendorCode
      : configContracts.byVendorCode;

  return NextResponse.json({
    source,
    meta: stored?.meta ?? null,
    byVendorCode,
    defaults: configContracts.default,
    fields: CONTRACT_FIELDS,
  });
}

/**
 * PUT /api/contracts — replace the contract set.
 * Body: { byVendorCode: { CODE: { floor, coopPct, ... } } }
 * Values may be fractions (0.30) or percents (30).
 */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const input = (body as { byVendorCode?: unknown })?.byVendorCode ?? body;
  const { ok, cleaned, errors } = validateContracts(input);
  if (!ok) {
    return NextResponse.json({ error: "Validation failed.", errors }, { status: 422 });
  }

  const doc = await saveContracts(cleaned);
  return NextResponse.json({ ok: true, ...doc });
}
