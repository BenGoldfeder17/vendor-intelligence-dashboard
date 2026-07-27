// Combines catalog, A+, sales and forecast data into the product-centric model,
// derives Style/Style10, and computes the Drags & Drivers insights + totals.

import type { Aggregate, AplusDocument, ForecastPoint, PoAcceptance, Product, VendorOrderInfo } from "./types";
import type { NormalizedCatalog } from "./spapi/catalog";
import type { AsinInfo } from "./spapi/aplus";
import type { VendorSalesResult } from "./spapi/vendorSales";
import type { PoStatusResult } from "./spapi/vendorOrderStatus";
import { computeInsights } from "./insights";

export interface AggregateInput {
  sales: VendorSalesResult;
  forecast: Map<string, ForecastPoint[]>;
  catalog: Map<string, NormalizedCatalog | null>;
  aplus: Map<string, AplusDocument[]>;
  /** Title/image/parent recovered from A+ ASIN relations (fallback for catalog). */
  aplusInfo: Map<string, AsinInfo>;
  vendorOrders: Map<string, VendorOrderInfo>;
  poStatus: PoStatusResult | null;
  seedAsins: string[];
  marketplaceId: string;
  account: string;
  salesPeriod: string;
  warnings: string[];
  generatedAt: string;
}

export function buildAggregate(input: AggregateInput): Aggregate {
  // The full universe of ASINs is the union across every source.
  // The product universe is the COMMERCIAL catalog: anything with sales, forecast,
  // POs, or an explicit seed. A+ data (which can reference ~18k variation/child
  // ASINs) only ENRICHES these with titles/images/content — it doesn't add rows.
  const asins = new Set<string>([
    ...input.sales.byAsin.keys(),
    ...input.forecast.keys(),
    ...input.catalog.keys(),
    ...input.vendorOrders.keys(),
    ...(input.poStatus ? input.poStatus.byAsin.keys() : []),
    ...input.seedAsins,
  ]);

  const products: Product[] = [];
  for (const asin of asins) {
    const cat = input.catalog.get(asin) ?? null;
    const sale = input.sales.byAsin.get(asin) ?? null;
    const info = input.aplusInfo.get(asin) ?? null;
    const { style, style10 } = deriveStyle(cat);

    // Prefer authoritative catalog data; fall back to A+-derived title/image.
    const images =
      cat?.images && cat.images.length
        ? cat.images
        : info?.imageUrl
          ? [{ variant: "MAIN", link: info.imageUrl }]
          : [];

    products.push({
      asin,
      parentAsin: info?.parent ?? null,
      style,
      style10,
      title: cat?.title ?? info?.title ?? null,
      brand: cat?.brand ?? null,
      images,
      bullets: cat?.bullets ?? [],
      description: cat?.description ?? null,
      productType: cat?.productType ?? null,
      salesRank: cat?.salesRank ?? null,
      salesRankCategory: cat?.salesRankCategory ?? null,
      attributes: cat?.attributes ?? {},
      aplus: input.aplus.get(asin) ?? [],
      sales: sale?.summary ?? null,
      salesSeries: sale?.series ?? [],
      forecast: input.forecast.get(asin) ?? [],
      vendor: input.vendorOrders.get(asin) ?? null,
      poStatus: input.poStatus?.byAsin.get(asin) ?? null,
      poMonthly: input.poStatus?.byAsinMonthly.get(asin) ?? {},
      insight: null,
    });
  }

  // Default sort: highest shipped revenue first.
  products.sort((a, b) => (b.sales?.shippedRevenue ?? 0) - (a.sales?.shippedRevenue ?? 0));

  const { drivers, drags } = computeInsights(products);

  return {
    meta: {
      generatedAt: input.generatedAt,
      account: input.account,
      marketplaceId: input.marketplaceId,
      salesPeriod: input.salesPeriod,
      salesWindow: input.sales.window,
      productCount: products.length,
      warnings: input.warnings,
    },
    products,
    drivers,
    drags,
    totals: {
      sales: input.sales.totals,
      asinCount: products.length,
    },
    po: input.poStatus
      ? {
          totals: input.poStatus.totals,
          poCount: input.poStatus.poCount,
          window: input.poStatus.window,
          monthly: input.poStatus.portfolioMonthly,
        }
      : null,
  };
}

/**
 * Best-effort Style / Style10 derivation. Vendors' internal style codes are not
 * a first-class SP-API field, so we read the catalog attributes configured via
 * STYLE_ATTR / STYLE10_ATTR (default model_number / part_number). Style10 is the
 * 10-char vendor part number; Style its root (first 8 chars) when not otherwise
 * provided. Override the attribute names in .env to match your catalog.
 */
function deriveStyle(cat: NormalizedCatalog | null): { style: string | null; style10: string | null } {
  if (!cat) return { style: null, style10: null };
  const style10 = cat.style10Raw?.trim() || null;
  let style = cat.styleRaw?.trim() || null;
  if (!style && style10 && style10.length > 8) style = style10.slice(0, 8);
  return { style, style10 };
}
