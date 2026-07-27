// Aggregated, product-centric data model used by the UI and API routes.
// This is the shape written to the on-disk cache by the sync job.

export interface SalesPoint {
  /** Period start, ISO date (YYYY-MM-DD). */
  date: string;
  shippedUnits: number;
  shippedRevenue: number;
  /** Amazon's cost of goods for the units it shipped — the margin denominator. */
  shippedCogs: number;
  orderedUnits: number;
  orderedRevenue: number;
  customerReturns: number;
}

export interface SalesSummary {
  shippedUnits: number;
  shippedRevenue: number;
  shippedCogs: number;
  orderedUnits: number;
  orderedRevenue: number;
  customerReturns: number;
  /** Currency code from the report, best-effort. */
  currency: string;
}

export interface ForecastPoint {
  /** Forecast period start, ISO date. */
  date: string;
  /** Mean forecast units for the period. */
  meanUnits: number;
  p70Units?: number;
  p80Units?: number;
  p90Units?: number;
}

export interface AplusBlock {
  /** Plain-text representation of a module, for simple rendering. */
  type: string;
  text?: string;
  images?: string[];
  /** Optional module heading (e.g. tech-spec title). */
  heading?: string;
  /** Structured table for comparison / tech-spec modules. */
  table?: { headers: string[]; rows: string[][] };
}

export interface AplusDocument {
  contentReferenceKey: string;
  name?: string;
  status?: string;
  blocks: AplusBlock[];
}

export interface AmazonImage {
  variant: string; // MAIN, PT01, SWCH, etc.
  link: string;
  width?: number;
  height?: number;
}

/**
 * PO acknowledgement breakdown from getPurchaseOrdersStatus, per ASIN or portfolio.
 * "cancelled" = vendor-rejected units. "downcounted" = units Amazon removed from the
 * PO after it was placed (from ordered-quantity history). Backordered acknowledgements
 * are not separable in the Vendor Orders status API — they fold into accepted.
 */
export interface PoAcceptance {
  orderedUnits: number;
  acceptedUnits: number;
  cancelledUnits: number;
  unconfirmedUnits: number;
  downcountedUnits: number;
  receivedUnits: number;
  /** Number of PO line items. */
  lines: number;
  /** Net-cost value (Amazon's spend) of ordered / accepted / cancelled units. */
  orderedValue: number;
  acceptedValue: number;
  cancelledValue: number;
  currency: string;
}

export interface VendorOrderInfo {
  /** Retail list price from the most recent PO. */
  listPrice: number | null;
  /** Net cost Amazon pays you, from the most recent PO. */
  netCost: number | null;
  currency: string;
  /** Total units ordered across POs in the window. */
  orderedUnits: number;
  poCount: number;
  lastOrderDate: string | null;
  vendorProductId: string | null;
}

export interface Product {
  asin: string;
  parentAsin: string | null;
  style: string | null;
  style10: string | null;

  // ─── Catalog / "All Amazon Info" ───
  title: string | null;
  brand: string | null;
  images: AmazonImage[];
  bullets: string[];
  description: string | null;
  productType: string | null;
  salesRank: number | null;
  salesRankCategory: string | null;
  /** Flattened attribute map straight from the catalog item ("All Amazon Info"). */
  attributes: Record<string, unknown>;

  // ─── A+ Content ───
  aplus: AplusDocument[];

  // ─── Sales ───
  sales: SalesSummary | null;
  salesSeries: SalesPoint[];

  // ─── Forecast ───
  forecast: ForecastPoint[];

  // ─── Vendor Orders economics (list price, net cost) ───
  vendor: VendorOrderInfo | null;

  // ─── PO acceptance (accepted / cancelled / unconfirmed / received) ───
  poStatus: PoAcceptance | null;
  /**
   * Per-month PO buckets for date filtering / period comparison. Compact arrays:
   * [orderedUnits, acceptedUnits, cancelledUnits, unconfirmedUnits, receivedUnits,
   *  orderedValue, acceptedValue, cancelledValue], keyed "YYYY-MM".
   */
  poMonthly: Record<string, number[]>;

  // ─── Drivers/Drags contribution (period over period) ───
  insight: ProductInsight | null;
}

export interface ProductInsight {
  asin: string;
  title: string | null;
  style10: string | null;
  /** Revenue in the current half of the window vs the prior half. */
  currentRevenue: number;
  priorRevenue: number;
  deltaRevenue: number;
  deltaPct: number | null;
  currentUnits: number;
  priorUnits: number;
  deltaUnits: number;
  /** Share of the total positive (driver) or negative (drag) movement. */
  contributionPct: number;
  kind: "driver" | "drag" | "flat";
}

export interface AggregateMeta {
  generatedAt: string;
  /** Fingerprint of the account this data belongs to (for cache invalidation). */
  account?: string;
  marketplaceId: string;
  salesPeriod: string;
  salesWindow: { start: string; end: string };
  productCount: number;
  /** Non-fatal problems encountered during sync (per source). */
  warnings: string[];
}

export interface Aggregate {
  meta: AggregateMeta;
  products: Product[];
  drivers: ProductInsight[];
  drags: ProductInsight[];
  totals: {
    sales: SalesSummary;
    asinCount: number;
  };
  /** Portfolio PO acceptance across all line items in the window. */
  po: {
    totals: PoAcceptance;
    poCount: number;
    window: { start: string; end: string };
    /** Portfolio monthly buckets (compact arrays, see Product.poMonthly). */
    monthly: Record<string, number[]>;
  } | null;
}

export type SyncPhase =
  | "idle"
  | "auth"
  | "vendor-sales"
  | "vendor-forecast"
  | "vendor-orders"
  | "vendor-po-status"
  | "catalog"
  | "aplus"
  | "aggregating"
  | "done"
  | "error";

export interface SyncStatus {
  phase: SyncPhase;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  progress: { current: number; total: number };
  warnings: string[];
  error: string | null;
}
