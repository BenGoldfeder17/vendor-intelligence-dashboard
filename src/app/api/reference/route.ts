import { NextResponse } from "next/server";
import { parseReferenceCsv, readReference, writeReference, deleteReference } from "@/lib/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/reference — metadata about the loaded reference table. */
export async function GET() {
  const ref = await readReference();
  if (!ref) return NextResponse.json({ loaded: false });
  return NextResponse.json({ loaded: true, meta: ref.meta });
}

/** POST /api/reference — upload the reference CSV (raw body = CSV text). */
export async function POST(req: Request) {
  const text = await req.text();
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "Empty upload." }, { status: 400 });
  }
  const parsed = parseReferenceCsv(text);
  if (!parsed.rows.length) {
    return NextResponse.json(
      { error: parsed.errors.join(" ") || "No data rows found.", detectedColumns: parsed.detectedColumns },
      { status: 400 }
    );
  }
  const meta = {
    uploadedAt: new Date().toISOString(),
    rowCount: parsed.rows.length,
    hadBrandColumn: parsed.hadBrandColumn,
    detectedColumns: parsed.detectedColumns,
  };
  await writeReference({ meta, rows: parsed.rows });
  return NextResponse.json({ ok: true, meta, warnings: parsed.errors });
}

/** DELETE /api/reference — clear the reference table. */
export async function DELETE() {
  await deleteReference();
  return NextResponse.json({ ok: true });
}
