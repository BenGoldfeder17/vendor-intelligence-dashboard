// Code-aware PO confirmation analysis: joins the reference layer (ASIN, Style,
// Brand, Code, on-hand) to PO acceptance data and classifies every line into
// Recoverable / Mark-Unavailable / True-Stockout, split own-brand vs other brands.
// Brand labels and the own-brand matchers are configured in app.config.ts.

import type { Aggregate } from "./types";
import { identity } from "@/config/app.config";
import { CODE_LABELS, cancelCodes, type ReferenceData } from "./reference";
import { allMonths, productPo, sumMonths, windowMonths, zeroSums, type PoSums } from "./poWindow";

export type Brand = "OWN" | "OTHER";
export type Bucket = "recoverable" | "unavailable" | "stockout" | "ok";

export interface ConfRow {
  asin: string;
  style: string | null;
  brand: Brand;
  code: string | null;
  codeLabel: string;
  onHand: number;
  orderedUnits: number;
  acceptedUnits: number;
  cancelledUnits: number;
  rejectedValue: number; // net-cost $ of cancelled units (missed revenue)
  bucket: Bucket;
  title: string | null;
}

export interface BucketStat {
  asins: number;
  rejectedValue: number;
  onHandUnits: number;
  cancelledUnits: number;
}

export interface Segment {
  brand: Brand | "ALL";
  asins: number;
  submitted: number;
  accepted: number;
  rejected: number;
  orderedUnits: number;
  acceptedUnits: number;
  cancelledUnits: number;
  confirmationRate: number | null; // accepted units / ordered units
  buckets: Record<Bucket, BucketStat>;
}

export interface CodeRow {
  code: string;
  label: string;
  ownAsins: number;
  brandedAsins: number;
  ownRejected: number;
  brandedRejected: number;
  totalRejected: number;
  totalAsins: number;
}

export interface PriorSummary {
  submitted: number;
  accepted: number;
  rejected: number;
  recoverableValue: number;
  confirmationRate: number | null;
}

export interface ConfirmationReport {
  meta: ReferenceData["meta"];
  generatedAt: string;
  brandInferred: boolean;
  currency: string;
  segments: Record<Brand | "ALL", Segment>;
  recoverable: ConfRow[];
  unavailable: ConfRow[];
  codeBreakdown: CodeRow[];
  counts: { referenceRows: number; withCode: number; withOnHand: number; matchedToPo: number };
  /** Date window used + the comparison (prior equal-length) period, if any. */
  window: {
    months: number | null; // trailing months selected (null = all)
    available: string[]; // all months present in the data (sorted)
    current: string[];
    prior: string[];
  };
  prior: Record<Brand | "ALL", PriorSummary> | null;
}

function emptyBucket(): BucketStat {
  return { asins: 0, rejectedValue: 0, onHandUnits: 0, cancelledUnits: 0 };
}
function emptySegment(brand: Brand | "ALL"): Segment {
  return {
    brand,
    asins: 0,
    submitted: 0,
    accepted: 0,
    rejected: 0,
    orderedUnits: 0,
    acceptedUnits: 0,
    cancelledUnits: 0,
    confirmationRate: null,
    buckets: { recoverable: emptyBucket(), unavailable: emptyBucket(), stockout: emptyBucket(), ok: emptyBucket() },
  };
}

function resolveBrand(raw: string | null, title: string | null): Brand {
  const matchers = identity.ownBrandMatchers;
  // With no configured matchers there is no basis to split, so everything is
  // treated as own-brand rather than silently mislabelling the catalog.
  if (matchers.length === 0) return "OWN";
  const r = (raw ?? "").toLowerCase();
  if (r) return matchers.some((m) => r.includes(m)) ? "OWN" : "OTHER";
  // Infer from title when the file has no brand column.
  const t = (title ?? "").toLowerCase();
  return matchers.some((m) => t.includes(m)) ? "OWN" : "OTHER";
}

function classify(hasCode: boolean, onHand: number): Bucket {
  if (hasCode && onHand > 0) return "recoverable";
  if (hasCode && onHand <= 0) return "unavailable";
  if (!hasCode && onHand <= 0) return "stockout";
  return "ok"; // in stock, no cancel code → healthy / confirmable
}

export function buildConfirmationReport(
  agg: Aggregate,
  ref: ReferenceData,
  generatedAt: string,
  monthsParam: number | null = null
): ConfirmationReport {
  // Index PO + title by ASIN from the aggregate.
  const po = new Map(agg.products.map((p) => [p.asin, p]));
  const currency = agg.totals.sales.currency;

  // Resolve the date window: current trailing N months + prior equal window.
  const available = allMonths(agg);
  const { current, prior } = windowMonths(available, monthsParam);
  const useWindow = monthsParam != null && monthsParam > 0 && monthsParam < available.length;
  const currentArg: string[] | null = useWindow ? current : null; // null → full total
  const hasPrior = prior.length > 0;

  const segments: Record<Brand | "ALL", Segment> = {
    OWN: emptySegment("OWN"),
    OTHER: emptySegment("OTHER"),
    ALL: emptySegment("ALL"),
  };
  // Prior-period accumulators (segment-level only, for comparison).
  const priorSums: Record<Brand | "ALL", PoSums & { recoverableValue: number }> = {
    OWN: { ...zeroSums(), recoverableValue: 0 },
    OTHER: { ...zeroSums(), recoverableValue: 0 },
    ALL: { ...zeroSums(), recoverableValue: 0 },
  };
  const recoverable: ConfRow[] = [];
  const unavailable: ConfRow[] = [];
  const codeMap = new Map<string, CodeRow>();

  let withCode = 0;
  let withOnHand = 0;
  let matchedToPo = 0;

  for (const r of ref.rows) {
    const prod = po.get(r.asin) ?? null;
    const brand = resolveBrand(r.brand, prod?.title ?? null);
    const codes = cancelCodes(r.code); // individual cancelling codes (may be several)
    const hasCode = codes.length > 0;
    const onHand = r.onHand;
    const bucket = classify(hasCode, onHand);

    const cur = prod ? productPo(prod, currentArg) : zeroSums();
    const orderedUnits = cur.orderedUnits;
    const acceptedUnits = cur.acceptedUnits;
    const cancelledUnits = cur.cancelledUnits;
    const submitted = cur.orderedValue;
    const accepted = cur.acceptedValue;
    const rejected = cur.cancelledValue;
    if (prod?.poStatus) matchedToPo++;
    if (hasCode) withCode++;
    if (onHand > 0) withOnHand++;

    // Prior window (segment-level only).
    if (hasPrior && prod) {
      const pri = sumMonths(prod.poMonthly, prior);
      for (const b of [brand, "ALL"] as const) {
        const acc = priorSums[b];
        acc.orderedUnits += pri.orderedUnits;
        acc.acceptedUnits += pri.acceptedUnits;
        acc.orderedValue += pri.orderedValue;
        acc.acceptedValue += pri.acceptedValue;
        acc.cancelledValue += pri.cancelledValue;
        if (bucket === "recoverable") acc.recoverableValue += pri.cancelledValue;
      }
    }

    const row: ConfRow = {
      asin: r.asin,
      style: r.style,
      brand,
      code: codes.length ? codes.join("/") : r.code,
      codeLabel: codes.length ? codes.map((c) => CODE_LABELS[c] ?? c).join(", ") : "—",
      onHand,
      orderedUnits,
      acceptedUnits,
      cancelledUnits,
      rejectedValue: rejected,
      bucket,
      title: prod?.title ?? null,
    };

    for (const seg of [segments[brand], segments.ALL]) {
      seg.asins++;
      seg.submitted += submitted;
      seg.accepted += accepted;
      seg.rejected += rejected;
      seg.orderedUnits += orderedUnits;
      seg.acceptedUnits += acceptedUnits;
      seg.cancelledUnits += cancelledUnits;
      const b = seg.buckets[bucket];
      b.asins++;
      b.rejectedValue += rejected;
      b.onHandUnits += Math.max(0, onHand); // oversold (negative) on-hand counts as 0
      b.cancelledUnits += cancelledUnits;
    }

    if (bucket === "recoverable") recoverable.push(row);
    if (bucket === "unavailable") unavailable.push(row);

    // Code breakdown — an ASIN counts under EACH cancelling code it carries
    // (so per-code ASIN counts can sum above the total, matching how the codes
    // are tallied in the source). Rejected $ is likewise attributed per code.
    for (const code of codes) {
      const cr = codeMap.get(code) ?? {
        code,
        label: CODE_LABELS[code] ?? code,
        ownAsins: 0,
        brandedAsins: 0,
        ownRejected: 0,
        brandedRejected: 0,
        totalRejected: 0,
        totalAsins: 0,
      };
      cr.totalAsins++;
      cr.totalRejected += rejected;
      if (brand === "OWN") {
        cr.ownAsins++;
        cr.ownRejected += rejected;
      } else {
        cr.brandedAsins++;
        cr.brandedRejected += rejected;
      }
      codeMap.set(code, cr);
    }
  }

  for (const seg of Object.values(segments)) {
    seg.confirmationRate = seg.orderedUnits > 0 ? seg.acceptedUnits / seg.orderedUnits : null;
  }

  // Recoverable ranked by missed revenue, then on-hand depth.
  recoverable.sort((a, b) => b.rejectedValue - a.rejectedValue || b.onHand - a.onHand);
  // Unavailable ranked by recent rejected $ (metric bleed), then code.
  unavailable.sort((a, b) => b.rejectedValue - a.rejectedValue || (a.code ?? "").localeCompare(b.code ?? ""));

  const codeBreakdown = [...codeMap.values()].sort((a, b) => b.totalRejected - a.totalRejected || b.totalAsins - a.totalAsins);

  const priorOut: Record<Brand | "ALL", PriorSummary> | null = hasPrior
    ? {
        OWN: priorSummary(priorSums.OWN),
        OTHER: priorSummary(priorSums.OTHER),
        ALL: priorSummary(priorSums.ALL),
      }
    : null;

  return {
    meta: ref.meta,
    generatedAt,
    brandInferred: !ref.meta.hadBrandColumn,
    currency,
    segments,
    recoverable,
    unavailable,
    codeBreakdown,
    counts: { referenceRows: ref.rows.length, withCode, withOnHand, matchedToPo },
    window: { months: monthsParam, available, current, prior },
    prior: priorOut,
  };
}

function priorSummary(s: PoSums & { recoverableValue: number }): PriorSummary {
  return {
    submitted: s.orderedValue,
    accepted: s.acceptedValue,
    rejected: s.cancelledValue,
    recoverableValue: s.recoverableValue,
    confirmationRate: s.orderedUnits > 0 ? s.acceptedUnits / s.orderedUnits : null,
  };
}
