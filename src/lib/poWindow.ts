// Date-window helpers for the per-ASIN monthly PO buckets (compact arrays).
// Index layout matches MONTHLY_LEN in spapi/vendorOrderStatus.ts.

import type { Aggregate, PoAcceptance, Product } from "./types";

export interface PoSums {
  orderedUnits: number;
  acceptedUnits: number;
  cancelledUnits: number;
  unconfirmedUnits: number;
  receivedUnits: number;
  orderedValue: number;
  acceptedValue: number;
  cancelledValue: number;
}

export function zeroSums(): PoSums {
  return {
    orderedUnits: 0,
    acceptedUnits: 0,
    cancelledUnits: 0,
    unconfirmedUnits: 0,
    receivedUnits: 0,
    orderedValue: 0,
    acceptedValue: 0,
    cancelledValue: 0,
  };
}

/** Sum a product's monthly buckets over the given months. */
export function sumMonths(poMonthly: Record<string, number[]> | undefined, months: string[]): PoSums {
  const s = zeroSums();
  if (!poMonthly) return s;
  for (const m of months) {
    const a = poMonthly[m];
    if (!a) continue;
    s.orderedUnits += a[0] || 0;
    s.acceptedUnits += a[1] || 0;
    s.cancelledUnits += a[2] || 0;
    s.unconfirmedUnits += a[3] || 0;
    s.receivedUnits += a[4] || 0;
    s.orderedValue += a[5] || 0;
    s.acceptedValue += a[6] || 0;
    s.cancelledValue += a[7] || 0;
  }
  return s;
}

/** Convert a full-window PoAcceptance total to the PoSums shape. */
export function fromTotal(p: PoAcceptance | null | undefined): PoSums {
  if (!p) return zeroSums();
  return {
    orderedUnits: p.orderedUnits,
    acceptedUnits: p.acceptedUnits,
    cancelledUnits: p.cancelledUnits,
    unconfirmedUnits: p.unconfirmedUnits,
    receivedUnits: p.receivedUnits,
    orderedValue: p.orderedValue,
    acceptedValue: p.acceptedValue,
    cancelledValue: p.cancelledValue,
  };
}

/** Sorted distinct months present in the portfolio PO data. */
export function allMonths(agg: Aggregate): string[] {
  const m = agg.po?.monthly ? Object.keys(agg.po.monthly) : [];
  return m.sort();
}

/**
 * Given the sorted month list and a trailing window size, return the current
 * window and the immediately-preceding equal-length window (for comparison).
 * months=null → current = all months, prior = none.
 */
export function windowMonths(
  all: string[],
  months: number | null
): { current: string[]; prior: string[] } {
  if (!months || months <= 0 || months >= all.length) {
    return { current: all, prior: [] };
  }
  const current = all.slice(all.length - months);
  const prior = all.slice(Math.max(0, all.length - 2 * months), all.length - months);
  return { current, prior };
}

/** Per-product PO metrics for a window (sum monthly buckets, or full total). */
export function productPo(p: Product, months: string[] | null): PoSums {
  if (months === null) return fromTotal(p.poStatus);
  return sumMonths(p.poMonthly, months);
}
