import { readAggregate } from "@/lib/cache";
import { readReference } from "@/lib/reference";
import { buildConfirmationReport, type ConfRow } from "@/lib/confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/confirmation/export?bucket=recoverable|unavailable&brand=OWN|OTHER|all
 * Returns the full classified list as a CSV download.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") === "unavailable" ? "unavailable" : "recoverable";
  const brand = url.searchParams.get("brand"); // OWN | OTHER | null(all)
  const raw = url.searchParams.get("months");
  const months = raw && raw !== "all" ? Math.max(1, parseInt(raw, 10) || 0) || null : null;

  const agg = await readAggregate();
  const ref = await readReference();
  if (!agg || !ref) return new Response("No data", { status: 404 });

  const report = buildConfirmationReport(agg, ref, new Date().toISOString(), months);
  let rows: ConfRow[] = bucket === "unavailable" ? report.unavailable : report.recoverable;
  if (brand === "OWN" || brand === "OTHER") rows = rows.filter((r) => r.brand === brand);

  const header = [
    "ASIN",
    "Style",
    "Brand",
    "Code",
    "Code Label",
    "eComm On Hand",
    "Ordered Units",
    "Accepted Units",
    "Cancelled Units",
    "Rejected $ (net cost)",
    "Title",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.asin,
        csv(r.style),
        r.brand,
        r.code ?? "",
        csv(r.codeLabel),
        r.onHand,
        r.orderedUnits,
        r.acceptedUnits,
        r.cancelledUnits,
        r.rejectedValue.toFixed(2),
        csv(r.title),
      ].join(",")
    );
  }

  const filename = `${bucket}-${brand ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function csv(v: string | null): string {
  if (v == null) return "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
