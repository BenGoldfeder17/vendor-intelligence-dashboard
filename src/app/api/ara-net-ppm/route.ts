import { NextResponse } from "next/server";
import {
  parseAraNetPpmCsv,
  readAraNetPpm,
  writeAraNetPpm,
  deleteAraNetPpm,
} from "@/lib/araNetPpm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await readAraNetPpm();
  if (!data) return NextResponse.json({ loaded: false });
  return NextResponse.json({ loaded: true, meta: data.meta });
}

/** POST /api/ara-net-ppm — raw CSV body. */
export async function POST(req: Request) {
  const text = await req.text();
  if (!text?.trim()) return NextResponse.json({ error: "Empty upload." }, { status: 400 });

  const parsed = parseAraNetPpmCsv(text);
  if (!parsed.rows.length) {
    return NextResponse.json(
      { error: parsed.errors.join(" ") || "No data rows.", detectedColumns: parsed.detectedColumns },
      { status: 400 }
    );
  }
  const meta = {
    uploadedAt: new Date().toISOString(),
    rowCount: parsed.rows.length,
    detectedColumns: parsed.detectedColumns,
  };
  await writeAraNetPpm({ meta, rows: parsed.rows });
  return NextResponse.json({ ok: true, meta, warnings: parsed.errors });
}

export async function DELETE() {
  await deleteAraNetPpm();
  return NextResponse.json({ ok: true });
}
