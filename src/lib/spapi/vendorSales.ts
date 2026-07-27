// Pulls vendor sales by reusing recent DONE GET_VENDOR_SALES_REPORT documents and
// merging them into per-ASIN time series + summaries. Overlapping reports are
// de-duplicated by (asin, period date) so revenue/units are never double counted.

import { getConfig } from "./config";
import { getReportsData } from "./reports";
import type { SalesPoint, SalesSummary } from "../types";

interface Money {
  amount?: number;
  currencyCode?: string;
}

interface SalesByAsinRow {
  startDate?: string;
  endDate?: string;
  asin?: string;
  orderedUnits?: number;
  orderedRevenue?: Money;
  shippedUnits?: number;
  shippedRevenue?: Money;
  /** GET_VENDOR_SALES_REPORT returns this; we were dropping it. */
  shippedCogs?: Money;
  customerReturns?: number;
}

interface VendorSalesReport {
  salesByAsin?: SalesByAsinRow[];
}

export interface VendorSalesResult {
  byAsin: Map<string, { series: SalesPoint[]; summary: SalesSummary }>;
  totals: SalesSummary;
  window: { start: string; end: string };
}

export async function fetchVendorSales(onProgress?: (msg: string) => void): Promise<VendorSalesResult> {
  const cfg = getConfig();
  const end = dayUTC(3); // vendor data lags a few days
  const start = dayUTC(3 + cfg.salesLookbackDays);

  const docs = (await getReportsData(
    {
      reportType: "GET_VENDOR_SALES_REPORT",
      dataStartTime: start,
      dataEndTime: end,
      reportOptions: {
        reportPeriod: cfg.salesPeriod,
        distributorView: cfg.distributorView,
        sellingProgram: cfg.sellingProgram,
      },
    },
    cfg.salesMaxReports,
    onProgress,
    // Expect roughly one weekly report per 7 days of lookback (capped at the
    // configured max). If reuse yields fewer, force a fresh full-window report.
    cfg.salesPeriod === "WEEK"
      ? Math.min(cfg.salesMaxReports, Math.floor(cfg.salesLookbackDays / 7))
      : undefined
  )) as VendorSalesReport[];

  // De-dupe rows across reports by asin + period start.
  const seen = new Map<string, SalesByAsinRow>();
  let currency = "USD";
  for (const doc of docs) {
    for (const r of doc?.salesByAsin ?? []) {
      if (!r.asin) continue;
      const date = (r.startDate || r.endDate || "").slice(0, 10);
      const key = `${r.asin}|${date}`;
      if (!seen.has(key)) seen.set(key, r);
      currency = r.shippedRevenue?.currencyCode || r.orderedRevenue?.currencyCode || currency;
    }
  }

  const byAsin = new Map<string, { series: SalesPoint[]; summary: SalesSummary }>();
  const totals: SalesSummary = emptySummary(currency);
  let minDate = "9999-99-99";
  let maxDate = "0000-00-00";

  for (const r of seen.values()) {
    const date = (r.startDate || r.endDate || "").slice(0, 10);
    if (date) {
      if (date < minDate) minDate = date;
      if (date > maxDate) maxDate = date;
    }
    const point: SalesPoint = {
      date,
      shippedUnits: num(r.shippedUnits),
      shippedRevenue: num(r.shippedRevenue?.amount),
      shippedCogs: num(r.shippedCogs?.amount),
      orderedUnits: num(r.orderedUnits),
      orderedRevenue: num(r.orderedRevenue?.amount),
      customerReturns: num(r.customerReturns),
    };
    let entry = byAsin.get(r.asin!);
    if (!entry) {
      entry = { series: [], summary: emptySummary(currency) };
      byAsin.set(r.asin!, entry);
    }
    entry.series.push(point);
    addInto(entry.summary, point);
    addInto(totals, point);
  }

  // A single period can appear as multiple rows for an ASIN (rare); collapse by date.
  for (const e of byAsin.values()) {
    e.series = collapseByDate(e.series);
  }

  onProgress?.(`Vendor sales: ${byAsin.size} ASIN(s) across ${docs.length} report(s).`);
  return {
    byAsin,
    totals,
    window: { start: minDate === "9999-99-99" ? start.slice(0, 10) : minDate, end: maxDate === "0000-00-00" ? end.slice(0, 10) : maxDate },
  };
}

function collapseByDate(series: SalesPoint[]): SalesPoint[] {
  const m = new Map<string, SalesPoint>();
  for (const p of series) {
    const ex = m.get(p.date);
    if (!ex) m.set(p.date, { ...p });
    else {
      ex.shippedUnits += p.shippedUnits;
      ex.shippedRevenue += p.shippedRevenue;
      ex.shippedCogs += p.shippedCogs;
      ex.orderedUnits += p.orderedUnits;
      ex.orderedRevenue += p.orderedRevenue;
      ex.customerReturns += p.customerReturns;
    }
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function addInto(s: SalesSummary, p: SalesPoint): void {
  s.shippedUnits += p.shippedUnits;
  s.shippedRevenue += p.shippedRevenue;
  s.shippedCogs += p.shippedCogs;
  s.orderedUnits += p.orderedUnits;
  s.orderedRevenue += p.orderedRevenue;
  s.customerReturns += p.customerReturns;
}

function emptySummary(currency = "USD"): SalesSummary {
  return {
    shippedUnits: 0,
    shippedRevenue: 0,
    shippedCogs: 0,
    orderedUnits: 0,
    orderedRevenue: 0,
    customerReturns: 0,
    currency,
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Midnight-UTC ISO timestamp N days before today. */
function dayUTC(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().replace(".000Z", "Z");
}
