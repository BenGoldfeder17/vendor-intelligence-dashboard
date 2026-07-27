import { NextResponse } from "next/server";
import { listSubmissions, upsertSubmission } from "@/lib/submissions";
import { getProductTypeSchema, buildAttributes, validateValues } from "@/lib/productTypes";
import { getConfig } from "@/lib/spapi/config";
import { putListingsItem } from "@/lib/spapi/listingsItems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/submissions/{id}/submit — actually push the listing to Amazon.
 *
 * Builds the SAME payload the form previews (buildAttributes), validates it
 * locally first, then calls putListingsItem. On an accepted submit the record
 * flips to "submitted"; the existing sync loop turns it "live" when the SKU
 * appears in the catalog.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = (await listSubmissions()).find((s) => s.id === id);
  if (!sub) return NextResponse.json({ error: "Submission not found." }, { status: 404 });

  let schema;
  try {
    schema = await getProductTypeSchema(sub.productType);
  } catch (e) {
    return NextResponse.json({ error: `Couldn't load schema: ${(e as Error).message}` }, { status: 502 });
  }

  // Never send something we already know Amazon will reject.
  const errors = validateValues(schema.fields, sub.values);
  if (errors.length) {
    return NextResponse.json(
      { error: "Fix these before submitting.", errors },
      { status: 422 }
    );
  }

  const cfg = getConfig();
  const attributes = buildAttributes(schema.fields, sub.values, cfg.marketplaceId);

  const result = await putListingsItem(sub.sku, sub.productType, attributes);

  if (result.blocked) {
    return NextResponse.json({ error: result.blocked, status: result.status }, { status: 400 });
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: "Amazon rejected the listing.", status: result.status, issues: result.issues },
      { status: 422 }
    );
  }

  // Accepted — mark submitted (sync will flip it to live when the SKU lands).
  const updated = await upsertSubmission({
    ...sub,
    status: "submitted",
    submittedAt: new Date().toISOString(),
    note: result.submissionId ? `Amazon submissionId ${result.submissionId}` : sub.note,
  });

  return NextResponse.json({
    ok: true,
    status: result.status,
    submissionId: result.submissionId,
    issues: result.issues,
    submission: updated,
  });
}
