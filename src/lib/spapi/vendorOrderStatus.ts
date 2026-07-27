// getPurchaseOrdersStatus (Vendor Orders API v1). Returns per-line acknowledgement
// status: what Amazon ORDERED vs what we ACCEPTED vs CANCELLED (rejected) vs left
// UNCONFIRMED, plus how much was RECEIVED and any DOWNCOUNT (ordered qty reduced
// after the PO was placed, derived from the ordered-quantity history).
//
// Note: the status API has no separate "backordered" quantity — a backordered
// acknowledgement is reported as accepted, so it can't be split out here.

import { getConfig } from "./config";
import { request } from "./client";
import type { PoAcceptance } from "../types";

interface Money {
  amount?: string | number;
  currencyCode?: string;
}
interface Qty {
  amount?: number;
}
interface ItemStatus {
  buyerProductIdentifier?: string;
  vendorProductIdentifier?: string;
  netCost?: Money;
  orderedQuantity?: {
    orderedQuantity?: Qty;
    orderedQuantityDetails?: Array<{ updatedDate?: string; orderedQuantity?: Qty }>;
  };
  acknowledgementStatus?: {
    confirmationStatus?: string;
    acceptedQuantity?: Qty;
    rejectedQuantity?: Qty;
  };
  receivingStatus?: {
    receiveStatus?: string;
    receivedQuantity?: Qty;
  };
}
interface OrderStatus {
  purchaseOrderNumber?: string;
  purchaseOrderStatus?: string;
  purchaseOrderDate?: string;
  lastUpdatedDate?: string;
  itemStatus?: ItemStatus[];
}
interface Response {
  payload?: { ordersStatus?: OrderStatus[]; pagination?: { nextToken?: string } };
}

// Compact period-bucket array indices (keeps the cache small). Buckets are keyed
// by ISO week-start (Monday) so date filters can go down to "last week".
// [orderedUnits, acceptedUnits, cancelledUnits, unconfirmedUnits, receivedUnits,
//  orderedValue, acceptedValue, cancelledValue]
export const MONTHLY_LEN = 8;

/** ISO week start (Monday), YYYY-MM-DD, for a date string. */
function weekStart(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export interface PoStatusResult {
  byAsin: Map<string, PoAcceptance>;
  /** Per-ASIN monthly buckets: asin → { "YYYY-MM": number[8] }. */
  byAsinMonthly: Map<string, Record<string, number[]>>;
  /** Portfolio monthly buckets: { "YYYY-MM": number[8] }. */
  portfolioMonthly: Record<string, number[]>;
  totals: PoAcceptance;
  poCount: number;
  window: { start: string; end: string };
}

function addMonth(map: Record<string, number[]>, month: string, vals: number[]): void {
  let a = map[month];
  if (!a) {
    a = new Array(MONTHLY_LEN).fill(0);
    map[month] = a;
  }
  for (let i = 0; i < MONTHLY_LEN; i++) a[i] += vals[i];
}

export async function fetchPoStatus(onProgress?: (m: string) => void): Promise<PoStatusResult> {
  const cfg = getConfig();
  const end = new Date();
  const start = new Date(end.getTime() - cfg.poLookbackDays * 86_400_000);
  const createdAfter = start.toISOString();

  const byAsin = new Map<string, PoAcceptance>();
  const byAsinMonthly = new Map<string, Record<string, number[]>>();
  const portfolioMonthly: Record<string, number[]> = {};
  const totals = empty();
  let poCount = 0;
  let nextToken: string | undefined;
  let page = 0;
  const MAX_PAGES = 80;

  do {
    const res: Response = await request<Response>({
      path: "/vendor/orders/v1/purchaseOrdersStatus",
      query: { limit: 100, createdAfter, sortOrder: "DESC", nextToken },
    });
    const orders = res.payload?.ordersStatus ?? [];
    poCount += orders.length;
    for (const o of orders) {
      const month = weekStart(o.purchaseOrderDate || o.lastUpdatedDate || ""); // ISO week (Mon)
      for (const it of o.itemStatus ?? []) {
        const asin = it.buyerProductIdentifier || it.vendorProductIdentifier;
        if (!asin) continue;
        const ack = it.acknowledgementStatus;
        const ordered = num(it.orderedQuantity?.orderedQuantity?.amount);
        const accepted = num(ack?.acceptedQuantity?.amount);
        const cancelled = num(ack?.rejectedQuantity?.amount);
        const received = num(it.receivingStatus?.receivedQuantity?.amount);
        const netCost = money(it.netCost?.amount);
        const currency = it.netCost?.currencyCode || totals.currency || "USD";
        const unconfirmed =
          (ack?.confirmationStatus ?? "UNCONFIRMED") === "UNCONFIRMED"
            ? Math.max(0, ordered - accepted - cancelled)
            : 0;
        // Downcount: highest historical ordered qty minus the current ordered qty.
        const hist = it.orderedQuantity?.orderedQuantityDetails ?? [];
        let downcounted = 0;
        if (hist.length > 1) {
          const amts = hist.map((h) => num(h.orderedQuantity?.amount));
          const peak = Math.max(...amts);
          downcounted = Math.max(0, peak - ordered);
        }

        const e = byAsin.get(asin) ?? empty(currency);
        e.orderedUnits += ordered;
        e.acceptedUnits += accepted;
        e.cancelledUnits += cancelled;
        e.unconfirmedUnits += unconfirmed;
        e.downcountedUnits += downcounted;
        e.receivedUnits += received;
        e.lines += 1;
        e.orderedValue += ordered * netCost;
        e.acceptedValue += accepted * netCost;
        e.cancelledValue += cancelled * netCost;
        e.currency = currency;
        byAsin.set(asin, e);

        totals.orderedUnits += ordered;
        totals.acceptedUnits += accepted;
        totals.cancelledUnits += cancelled;
        totals.unconfirmedUnits += unconfirmed;
        totals.downcountedUnits += downcounted;
        totals.receivedUnits += received;
        totals.lines += 1;
        totals.orderedValue += ordered * netCost;
        totals.acceptedValue += accepted * netCost;
        totals.cancelledValue += cancelled * netCost;
        totals.currency = currency;

        // Monthly buckets (per ASIN + portfolio).
        if (month) {
          const vals = [
            ordered,
            accepted,
            cancelled,
            unconfirmed,
            received,
            ordered * netCost,
            accepted * netCost,
            cancelled * netCost,
          ];
          let am = byAsinMonthly.get(asin);
          if (!am) {
            am = {};
            byAsinMonthly.set(asin, am);
          }
          addMonth(am, month, vals);
          addMonth(portfolioMonthly, month, vals);
        }
      }
    }
    nextToken = res.payload?.pagination?.nextToken;
    page += 1;
    onProgress?.(`PO status: ${poCount} PO(s), ${totals.lines} line(s) across ${page} page(s)…`);
  } while (nextToken && page < MAX_PAGES);

  return {
    byAsin,
    byAsinMonthly,
    portfolioMonthly,
    totals,
    poCount,
    window: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
  };
}

function empty(currency = "USD"): PoAcceptance {
  return {
    orderedUnits: 0,
    acceptedUnits: 0,
    cancelledUnits: 0,
    unconfirmedUnits: 0,
    downcountedUnits: 0,
    receivedUnits: 0,
    lines: 0,
    orderedValue: 0,
    acceptedValue: 0,
    cancelledValue: 0,
    currency,
  };
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
