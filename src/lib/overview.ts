// Portfolio-level aggregations computed from the cached product set:
// KPI rollups, portfolio time series, a forward forecast outlook, economics
// (markup / PO cost), and leaderboards. Computed on demand from the aggregate.

import type { Aggregate, SalesPoint } from "./types";
import { allMonths, fromTotal, sumMonths, windowMonths, type PoSums } from "./poWindow";
import { computeInsights } from "./insights";

export interface LeaderRow {
  asin: string;
  title: string | null;
  style10: string | null;
  value: number;
  secondary?: string;
}

export interface SalesSums {
  shippedUnits: number;
  shippedRevenue: number;
  shippedCogs: number;
  orderedUnits: number;
  orderedRevenue: number;
  customerReturns: number;
}

export interface OverviewData {
  meta: Aggregate["meta"] | null;
  /**
   * The window actually applied to the sales figures. `periods` is a trailing
   * count of sales-series points (weeks, when SALES_PERIOD=WEEK) — the same
   * unit the floating date bar emits.
   */
  salesWindow: {
    periods: number | null;
    start: string | null;
    end: string | null;
    priorStart: string | null;
    priorEnd: string | null;
    /** True when the selection covers the whole synced series. */
    isFull: boolean;
    /** Periods in the selected window, and in the whole synced series. */
    points: number;
    totalPoints: number;
    /** The full synced range, for context in the header. */
    syncStart: string;
    syncEnd: string;
  };
  /** Equal-length preceding window, for the "compare vs prior" toggle. */
  salesPrior: SalesSums | null;
  kpis: {
    shippedRevenue: number;
    orderedRevenue: number;
    shippedUnits: number;
    orderedUnits: number;
    customerReturns: number;
    returnRate: number | null; // returns / shipped units
    currency: string;
    asinCount: number;
    asinsWithSales: number;
    forecastUnitsHorizon: number;
    avgMarkupPct: number | null;
    asinsWithCost: number;
    totalPONetCost: number;
    driverCount: number;
    dragCount: number;
  };
  salesByDate: SalesPoint[];
  forecastByWeek: Array<{ date: string; meanUnits: number }>;
  leaderboards: {
    topRevenue: LeaderRow[];
    topDrivers: LeaderRow[];
    topDrags: LeaderRow[];
    topMarkup: LeaderRow[];
    topReturns: LeaderRow[];
  };
  /** Purchase-order economics for the selected date window (+ prior comparison). */
  po: {
    window: { months: number | null; available: string[]; current: string[]; prior: string[] };
    current: PoSums;
    prior: PoSums | null;
  } | null;
}

function zeroSales(): SalesSums {
  return {
    shippedUnits: 0,
    shippedRevenue: 0,
    shippedCogs: 0,
    orderedUnits: 0,
    orderedRevenue: 0,
    customerReturns: 0,
  };
}

function sumSales(rows: SalesPoint[]): SalesSums {
  const s = zeroSales();
  for (const r of rows) {
    s.shippedUnits += r.shippedUnits;
    s.shippedRevenue += r.shippedRevenue;
    s.shippedCogs += r.shippedCogs;
    s.orderedUnits += r.orderedUnits;
    s.orderedRevenue += r.orderedRevenue;
    s.customerReturns += r.customerReturns;
  }
  return s;
}

/** Trailing slice of a sorted series, plus the equal-length window before it. */
function windowSeries(
  series: SalesPoint[],
  periods: number | null
): { current: SalesPoint[]; prior: SalesPoint[]; isFull: boolean } {
  if (!periods || periods <= 0 || periods >= series.length) {
    return { current: series, prior: [], isFull: true };
  }
  const cut = series.length - periods;
  return {
    current: series.slice(cut),
    prior: series.slice(Math.max(0, cut - periods), cut),
    isFull: false,
  };
}

// Memoize the last few (aggregate, window) computations. buildOverview walks all
// products several times; when the user flips the date range between values they've
// already viewed — or reloads the same page — this returns instantly instead of
// recomputing. Keyed on the aggregate's generatedAt (changes only on sync) + months.
const overviewMemo = new Map<string, OverviewData>();
const OVERVIEW_MEMO_MAX = 12;

export function buildOverview(agg: Aggregate, months: number | null = null): OverviewData {
  const memoKey = `${agg.meta?.generatedAt ?? "?"}|${months ?? "all"}`;
  const cached = overviewMemo.get(memoKey);
  if (cached) return cached;

  const result = buildOverviewUncached(agg, months);
  // simple LRU-ish bound: drop oldest when full
  if (overviewMemo.size >= OVERVIEW_MEMO_MAX) {
    const first = overviewMemo.keys().next().value;
    if (first !== undefined) overviewMemo.delete(first);
  }
  overviewMemo.set(memoKey, result);
  return result;
}

function buildOverviewUncached(agg: Aggregate, months: number | null = null): OverviewData {
  const currency = agg.totals.sales.currency;

  // ── Portfolio time series (sum across ASINs by date) ──
  const dateMap = new Map<string, SalesPoint>();
  for (const p of agg.products) {
    for (const s of p.salesSeries) {
      const e = dateMap.get(s.date);
      if (!e) dateMap.set(s.date, { ...s });
      else {
        e.shippedUnits += s.shippedUnits;
        e.shippedRevenue += s.shippedRevenue;
        e.orderedUnits += s.orderedUnits;
        e.orderedRevenue += s.orderedRevenue;
        e.customerReturns += s.customerReturns;
      }
    }
  }
  const fullSeries = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Everything below reflects the SELECTED window, not the full sync window.
  const { current: salesByDate, prior: priorSeries, isFull } = windowSeries(fullSeries, months);
  const windowDates = new Set(salesByDate.map((s) => s.date));
  const windowed = sumSales(salesByDate);
  const salesPrior = priorSeries.length ? sumSales(priorSeries) : null;

  /** Per-ASIN sales restricted to the window. */
  const perAsin = agg.products.map((p) => ({
    p,
    rows: p.salesSeries.filter((s) => windowDates.has(s.date)),
  }));
  const asinSums = new Map(perAsin.map(({ p, rows }) => [p.asin, sumSales(rows)]));

  // ── Forecast outlook (sum mean units across ASINs by week) ──
  const fcMap = new Map<string, number>();
  for (const p of agg.products) {
    for (const f of p.forecast) fcMap.set(f.date, (fcMap.get(f.date) ?? 0) + f.meanUnits);
  }
  const forecastByWeek = [...fcMap.entries()]
    .map(([date, meanUnits]) => ({ date, meanUnits }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const forecastUnitsHorizon = forecastByWeek.reduce((a, f) => a + f.meanUnits, 0);

  // ── Economics ──
  let markupSum = 0;
  let markupN = 0;
  let asinsWithCost = 0;
  let totalPONetCost = 0;
  for (const p of agg.products) {
    const v = p.vendor;
    if (!v) continue;
    if (v.netCost != null) {
      asinsWithCost += 1;
      totalPONetCost += v.netCost * (v.orderedUnits || 0);
    }
    if (v.listPrice != null && v.netCost != null && v.listPrice > 0) {
      markupSum += (v.listPrice - v.netCost) / v.listPrice;
      markupN += 1;
    }
  }

  const t = windowed;
  const asinsWithSales = perAsin.filter(
    ({ p }) => (asinSums.get(p.asin)?.shippedUnits ?? 0) > 0
  ).length;

  // ── Leaderboards ──
  const withSales = agg.products.filter((p) => (asinSums.get(p.asin)?.shippedUnits ?? 0) > 0);
  const topRevenue: LeaderRow[] = withSales
    .slice()
    .sort(
      (a, b) =>
        (asinSums.get(b.asin)?.shippedRevenue ?? 0) - (asinSums.get(a.asin)?.shippedRevenue ?? 0)
    )
    .slice(0, 10)
    .map((p) => ({
      asin: p.asin,
      title: p.title,
      style10: p.style10,
      value: asinSums.get(p.asin)!.shippedRevenue,
      secondary: `${asinSums.get(p.asin)!.shippedUnits} units`,
    }));

  // Drags & Drivers split the window in half — so they must be recomputed for
  // the SELECTED window, not reused from the full-sync computation.
  const insight = isFull
    ? { drivers: agg.drivers, drags: agg.drags }
    : computeInsights(
        perAsin
          .filter(({ rows }) => rows.length > 0)
          .map(({ p, rows }) => ({ ...p, salesSeries: rows }))
      );

  const topDrivers: LeaderRow[] = insight.drivers.slice(0, 10).map((d) => ({
    asin: d.asin,
    title: d.title,
    style10: d.style10,
    value: d.deltaRevenue,
    secondary: `${d.contributionPct.toFixed(0)}% of growth`,
  }));
  const topDrags: LeaderRow[] = insight.drags.slice(0, 10).map((d) => ({
    asin: d.asin,
    title: d.title,
    style10: d.style10,
    value: d.deltaRevenue,
    secondary: `${d.contributionPct.toFixed(0)}% of decline`,
  }));

  const topMarkup: LeaderRow[] = agg.products
    .filter((p) => p.vendor?.listPrice != null && p.vendor?.netCost != null && p.vendor.listPrice > 0)
    .map((p) => ({
      asin: p.asin,
      title: p.title,
      style10: p.style10,
      value: ((p.vendor!.listPrice! - p.vendor!.netCost!) / p.vendor!.listPrice!) * 100,
      secondary: `list ${p.vendor!.listPrice!.toFixed(2)} / cost ${p.vendor!.netCost!.toFixed(2)}`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const topReturns: LeaderRow[] = withSales
    .filter((p) => (asinSums.get(p.asin)?.customerReturns ?? 0) > 0)
    .sort(
      (a, b) =>
        (asinSums.get(b.asin)?.customerReturns ?? 0) - (asinSums.get(a.asin)?.customerReturns ?? 0)
    )
    .slice(0, 10)
    .map((p) => {
      const s = asinSums.get(p.asin)!;
      return {
        asin: p.asin,
        title: p.title,
        style10: p.style10,
        value: s.customerReturns,
        secondary: s.shippedUnits
          ? `${((s.customerReturns / s.shippedUnits) * 100).toFixed(1)}% of shipped`
          : undefined,
      };
    });

  // ── Windowed PO economics (responds to the floating date range) ──
  let po: OverviewData["po"] = null;
  if (agg.po) {
    // NOTE: despite the naming, po."monthly" buckets are ISO WEEK starts
    // (vendorOrderStatus.weekStart → YYYY-MM-DD Monday). Periods are weeks, so
    // they line up 1:1 with the sales series — no conversion.
    const available = allMonths(agg);
    const { current, prior } = windowMonths(available, months);
    const useWindow = months != null && months > 0 && months < available.length;
    po = {
      window: { months, available, current, prior },
      current: useWindow ? sumMonths(agg.po.monthly, current) : fromTotal(agg.po.totals),
      prior: prior.length ? sumMonths(agg.po.monthly, prior) : null,
    };
  }

  return {
    meta: agg.meta,
    kpis: {
      shippedRevenue: t.shippedRevenue,
      orderedRevenue: t.orderedRevenue,
      shippedUnits: t.shippedUnits,
      orderedUnits: t.orderedUnits,
      customerReturns: t.customerReturns,
      returnRate: t.shippedUnits > 0 ? t.customerReturns / t.shippedUnits : null,
      currency,
      asinCount: agg.products.length,
      asinsWithSales,
      forecastUnitsHorizon,
      avgMarkupPct: markupN > 0 ? (markupSum / markupN) * 100 : null,
      asinsWithCost,
      totalPONetCost,
      driverCount: insight.drivers.length,
      dragCount: insight.drags.length,
    },
    salesWindow: {
      periods: months,
      start: salesByDate[0]?.date ?? null,
      end: salesByDate[salesByDate.length - 1]?.date ?? null,
      priorStart: priorSeries[0]?.date ?? null,
      priorEnd: priorSeries[priorSeries.length - 1]?.date ?? null,
      isFull,
      points: salesByDate.length,
      totalPoints: fullSeries.length,
      syncStart: agg.meta.salesWindow.start,
      syncEnd: agg.meta.salesWindow.end,
    },
    salesPrior,
    salesByDate,
    forecastByWeek,
    leaderboards: { topRevenue, topDrivers, topDrags, topMarkup, topReturns },
    po,
  };
}
