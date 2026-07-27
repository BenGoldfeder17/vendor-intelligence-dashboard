import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";
import { allMonths, productPo, sumMonths, windowMonths, type PoSums } from "@/lib/poWindow";
import type { PoAcceptance } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/po?months=N — PO acceptance for a window + prior-period comparison. */
export async function GET(req: Request) {
  const agg = await readAggregate();
  if (!agg || !agg.po) return NextResponse.json({ po: null, byAsin: [], meta: null });

  const raw = new URL(req.url).searchParams.get("months");
  const months = raw && raw !== "all" ? Math.max(1, parseInt(raw, 10) || 0) || null : null;

  const available = allMonths(agg);
  const { current, prior } = windowMonths(available, months);
  const useWindow = months != null && months > 0 && months < available.length;
  const curArg: string[] | null = useWindow ? current : null;

  const currency = agg.po.totals.currency;
  const totals: PoAcceptance = useWindow ? toAcceptance(sumMonths(agg.po.monthly, current), currency) : agg.po.totals;
  const priorTotals = prior.length ? toAcceptance(sumMonths(agg.po.monthly, prior), currency) : null;

  const byAsin = agg.products
    .map((p) => {
      const s = productPo(p, curArg);
      if (s.orderedUnits <= 0) return null;
      return {
        asin: p.asin,
        title: p.title,
        style10: p.style10,
        thumbnail: p.images.find((i) => i.variant === "MAIN")?.link ?? p.images[0]?.link ?? null,
        ordered: s.orderedUnits,
        accepted: s.acceptedUnits,
        cancelled: s.cancelledUnits,
        unconfirmed: s.unconfirmedUnits,
        downcounted: 0,
        received: s.receivedUnits,
        open: Math.max(0, s.acceptedUnits - s.receivedUnits),
        cancelledValue: s.cancelledValue,
        currency,
        acceptRate: s.orderedUnits > 0 ? s.acceptedUnits / s.orderedUnits : null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    meta: agg.meta,
    po: { totals, poCount: agg.po.poCount, window: agg.po.window },
    range: { months, available, current, prior },
    prior: priorTotals,
    byAsin,
  });
}

function toAcceptance(s: PoSums, currency: string): PoAcceptance {
  return {
    orderedUnits: s.orderedUnits,
    acceptedUnits: s.acceptedUnits,
    cancelledUnits: s.cancelledUnits,
    unconfirmedUnits: s.unconfirmedUnits,
    downcountedUnits: 0,
    receivedUnits: s.receivedUnits,
    lines: 0,
    orderedValue: s.orderedValue,
    acceptedValue: s.acceptedValue,
    cancelledValue: s.cancelledValue,
    currency,
  };
}
