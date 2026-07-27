// Vendor Orders API (v1). This role IS granted, so we use it to enrich each ASIN
// with real purchase-order economics: list price, net cost (what Amazon pays you),
// PO-ordered units, and PO count. Values reflect the most recent PO per ASIN.

import { getConfig } from "./config";
import { request } from "./client";
import type { VendorOrderInfo } from "../types";

interface Money {
  amount?: string | number;
  currencyCode?: string;
}

interface PoItem {
  amazonProductIdentifier?: string;
  vendorProductIdentifier?: string;
  orderedQuantity?: { amount?: number };
  netCost?: Money;
  listPrice?: Money;
}

interface PurchaseOrder {
  purchaseOrderNumber?: string;
  orderDetails?: {
    purchaseOrderDate?: string;
    items?: PoItem[];
  };
}

interface PurchaseOrdersResponse {
  payload?: {
    orders?: PurchaseOrder[];
    pagination?: { nextToken?: string };
  };
}

export async function fetchVendorOrders(
  onProgress?: (msg: string) => void
): Promise<Map<string, VendorOrderInfo>> {
  const cfg = getConfig();
  const createdAfter = new Date(Date.now() - cfg.poLookbackDays * 86_400_000).toISOString();

  const byAsin = new Map<string, VendorOrderInfo>();
  let nextToken: string | undefined;
  let page = 0;
  const MAX_PAGES = 50; // safety bound (5,000 POs)

  do {
    const res: PurchaseOrdersResponse = await request<PurchaseOrdersResponse>({
      path: "/vendor/orders/v1/purchaseOrders",
      query: {
        limit: 100,
        createdAfter,
        sortOrder: "DESC",
        includeDetails: "true",
        nextToken,
      },
    });
    const orders = res.payload?.orders ?? [];
    for (const o of orders) {
      const date = o.orderDetails?.purchaseOrderDate ?? "";
      for (const it of o.orderDetails?.items ?? []) {
        const asin = it.amazonProductIdentifier;
        if (!asin) continue;
        const listPrice = money(it.listPrice?.amount);
        const netCost = money(it.netCost?.amount);
        const currency = it.netCost?.currencyCode || it.listPrice?.currencyCode || "USD";
        const units = Number(it.orderedQuantity?.amount) || 0;

        const ex = byAsin.get(asin);
        if (!ex) {
          byAsin.set(asin, {
            listPrice,
            netCost,
            currency,
            orderedUnits: units,
            poCount: 1,
            lastOrderDate: date.slice(0, 10),
            vendorProductId: it.vendorProductIdentifier ?? null,
          });
        } else {
          ex.orderedUnits += units;
          ex.poCount += 1;
          // Keep price/cost from the most recent PO (orders are DESC by date).
          if (date.slice(0, 10) > (ex.lastOrderDate ?? "")) {
            ex.lastOrderDate = date.slice(0, 10);
            if (listPrice != null) ex.listPrice = listPrice;
            if (netCost != null) ex.netCost = netCost;
            ex.currency = currency;
          }
        }
      }
    }
    nextToken = res.payload?.pagination?.nextToken;
    page += 1;
    onProgress?.(`Vendor orders: ${byAsin.size} ASIN(s) across ${page} page(s)…`);
  } while (nextToken && page < MAX_PAGES);

  return byAsin;
}

function money(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
