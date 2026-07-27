import { NextResponse } from "next/server";
import {
  listSubmissions,
  upsertSubmission,
  deleteSubmission,
  reconcile,
  type Submission,
} from "@/lib/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/submissions — all submissions, with live-status reconciliation. */
export async function GET() {
  const subs = await reconcile(await listSubmissions());
  subs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json({ submissions: subs });
}

/** POST /api/submissions — create or update a submission. */
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Submission>;
  if (!body.sku?.trim() || !body.productType) {
    return NextResponse.json({ error: "sku and productType are required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const all = await listSubmissions();
  const existing = body.id ? all.find((s) => s.id === body.id) : undefined;
  const status = body.status ?? existing?.status ?? "draft";

  const sub: Submission = {
    id: existing?.id ?? crypto.randomUUID(),
    sku: body.sku.trim(),
    productType: body.productType,
    status,
    values: body.values ?? existing?.values ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    submittedAt:
      status === "submitted" ? existing?.submittedAt ?? now : existing?.submittedAt ?? null,
    liveAt: existing?.liveAt ?? null,
    asin: body.asin ?? existing?.asin ?? null,
    note: body.note ?? existing?.note ?? null,
  };

  await upsertSubmission(sub);
  return NextResponse.json({ submission: sub });
}

/** DELETE /api/submissions?id=... */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  await deleteSubmission(id);
  return NextResponse.json({ ok: true });
}
