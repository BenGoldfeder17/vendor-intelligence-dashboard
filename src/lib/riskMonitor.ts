// Revenue Risk Monitor — Panels 1-6 data layer. ALL READS.
//
// The reframe: Net PPM says whether Amazon makes money on an item, not whether
// Amazon is still selling it. This surfaces margin risk (Panels 1-3, 6) and
// your own suppression cost (Panel 4) and fill risk (Panel 5). It writes
// nothing and decides nothing — humans act on what it shows.
//
// Data sources (all read-only):
//   ARA Net PPM CSV   → uploaded via the reference/ARA store   (Panels 1-3, 6)
//   ARA Sales CSV     → the existing aggregate (vendor sales)  (weighting, Panel 5)
//   amazon_price_file → BigQuery, SendZeroFlags                (Panel 4)
//   asin_style_map    → BigQuery, ASIN↔Style bridge            (Panel 4 join)
//   amazon_inventory  → BigQuery, position/fill                (Panel 5)
//
// Anything not sourceable is reported as a blocker, not faked.

import { query, feedsTable, bigQueryEnabled } from "./bigquery";
import {
  thresholds,
  suppressionCodes,
  warehouse,
  contractFor,
  hasPerCodeContracts,
  totalAllowancePct,
} from "@/config/app.config";

/** Revenue-weighted Net PPM floor — set via NET_PPM_FLOOR in .env. */
export const NET_PPM_FLOOR = thresholds.netPpmFloor;
/** Net PPM below this is a broken tail, excluded from blends (Panel 6). */
export const BROKEN_TAIL_PPM = thresholds.brokenTailFloor;

// ─── Panel input types ──────────────────────────────────────────────────────

/** One row of the ARA Net PPM export, already parsed to numbers. */
export interface NetPpmRow {
  asin: string;
  brandCode: string | null;
  netPpm: number | null; // fraction, e.g. 0.36
  priorNetPpm: number | null; // prior-period, for trend
  shippedRevenue: number | null;
}

export interface FloorGauge {
  blendedNetPpm: number | null;
  floor: number;
  headroomPts: number | null;
  status: "green" | "amber" | "red";
  revenue: number;
  asinsScored: number;
}

export interface BrandCodeRow {
  brandCode: string;
  netPpm: number | null;
  /** This code's contracted floor — differs per vendor code. */
  floor: number;
  headroomPts: number | null;
  revenue: number;
  asins: number;
  status: "green" | "amber" | "red";
}

export interface RepriceTargets {
  count: number;
  revenue: number;
  trend: "up" | "down" | "flat" | null; // vs prior-period bps
  improvedCount: number;
  worsenedCount: number;
}

export interface DataQualityStrip {
  brokenTailAsins: number;
  brokenTailRevenue: number;
  note: string;
}

// ─── Panels 1-3, 6: pure functions over the Net PPM rows ─────────────────────

function statusFor(headroomPts: number | null): "green" | "amber" | "red" {
  if (headroomPts == null) return "amber";
  if (headroomPts < 0) return "red";
  if (headroomPts < thresholds.amberHeadroomPts) return "amber";
  return "green";
}

/** Panel 6 first: identify the broken tail so Panels 1-3 can exclude it. */
export function dataQuality(rows: NetPpmRow[]): DataQualityStrip {
  const broken = rows.filter((r) => r.netPpm != null && r.netPpm < BROKEN_TAIL_PPM);
  return {
    brokenTailAsins: broken.length,
    brokenTailRevenue: broken.reduce((s, r) => s + (r.shippedRevenue ?? 0), 0),
    note:
      broken.length > 0
        ? `${broken.length} ASIN(s) with Net PPM < ${(BROKEN_TAIL_PPM * 100).toFixed(0)}% excluded from blends — they'd wreck an unweighted average.`
        : "No broken-tail ASINs.",
  };
}

/** Rows that are safe to blend (finite margin, positive revenue). */
function scoreable(rows: NetPpmRow[]): NetPpmRow[] {
  return rows.filter(
    (r) => r.netPpm != null && r.netPpm >= BROKEN_TAIL_PPM && (r.shippedRevenue ?? 0) > 0
  );
}

/** Panel 1 — revenue-weighted blended Net PPM vs floor. */
export function floorGauge(rows: NetPpmRow[]): FloorGauge {
  const s = scoreable(rows);
  const revenue = s.reduce((a, r) => a + (r.shippedRevenue ?? 0), 0);
  // DIVIDE(SUM(margin), SUM(revenue)); margin = ppm * revenue per row.
  const margin = s.reduce((a, r) => a + (r.netPpm ?? 0) * (r.shippedRevenue ?? 0), 0);
  const blended = revenue > 0 ? margin / revenue : null;

  // Contracts differ per vendor code, so a single portfolio floor is meaningless.
  // The comparable figure is the revenue-weighted BLENDED floor: each code's own
  // negotiated floor, weighted by the revenue sitting under it.
  const weightedFloor = s.reduce(
    (a, r) => a + contractFor(r.brandCode).floor * (r.shippedRevenue ?? 0),
    0
  );
  const blendedFloor = revenue > 0 ? weightedFloor / revenue : thresholds.netPpmFloor;
  const headroomPts = blended != null ? (blended - blendedFloor) * 100 : null;

  return {
    blendedNetPpm: blended,
    floor: blendedFloor,
    headroomPts,
    status: statusFor(headroomPts),
    revenue,
    asinsScored: s.length,
  };
}

/** Panel 2 — per Brand Code, weakest headroom first. */
export function brandCodeConcentration(rows: NetPpmRow[]): BrandCodeRow[] {
  const byCode = new Map<string, NetPpmRow[]>();
  for (const r of scoreable(rows)) {
    const code = r.brandCode || "(unmapped)";
    (byCode.get(code) ?? byCode.set(code, []).get(code)!).push(r);
  }
  const out: BrandCodeRow[] = [];
  for (const [brandCode, list] of byCode) {
    const revenue = list.reduce((a, r) => a + (r.shippedRevenue ?? 0), 0);
    const margin = list.reduce((a, r) => a + (r.netPpm ?? 0) * (r.shippedRevenue ?? 0), 0);
    const netPpm = revenue > 0 ? margin / revenue : null;
    // Each vendor code is judged against the floor in ITS contract, not a
    // portfolio-wide number. Using one floor here ranks codes wrongly whenever
    // terms differ: a code at 31% can be healthy while one at 34% is underwater.
    const terms = contractFor(brandCode);
    const headroomPts = netPpm != null ? (netPpm - terms.floor) * 100 : null;
    out.push({
      brandCode,
      netPpm,
      floor: terms.floor,
      headroomPts,
      revenue,
      asins: list.length,
      status: statusFor(headroomPts),
    });
  }
  // Weakest on top — that's where the risk hides behind the safe blend.
  return out.sort((a, b) => (a.headroomPts ?? 999) - (b.headroomPts ?? 999));
}

/** Panel 3 — ASINs individually below the floor, with prior-period trend. */
export function repriceTargets(rows: NetPpmRow[]): RepriceTargets {
  // Below ITS OWN contracted floor, not a global one.
  const below = scoreable(rows).filter(
    (r) => (r.netPpm ?? 1) < contractFor(r.brandCode).floor
  );
  const count = below.length;
  const revenue = below.reduce((a, r) => a + (r.shippedRevenue ?? 0), 0);

  let improved = 0;
  let worsened = 0;
  for (const r of below) {
    if (r.priorNetPpm == null || r.netPpm == null) continue;
    if (r.netPpm > r.priorNetPpm) improved += 1;
    else if (r.netPpm < r.priorNetPpm) worsened += 1;
  }
  const trend =
    improved === 0 && worsened === 0
      ? null
      : worsened > improved
        ? "down"
        : improved > worsened
          ? "up"
          : "flat";

  return { count, revenue, trend, improvedCount: improved, worsenedCount: worsened };
}

// ─── Panel 4: vendor-side suppression ledger (warehouse join) ───────────────

/**
 * SendZeroFlags decode — the REAL legend, from Vendor Central's "Opt Key":
 *   D  Discontinued          → operational
 *   F  MOI/Factor            → operational
 *   H  Hazmat                → operational
 *   I  Inventory Control     → operational
 *   M  Margin                → margin
 *   N  Send Inventory        → NOT a suppression (the "ship it" flag; excluded)
 *   P  NetPPM                → margin
 *   Q  Quality Control       → operational
 *   S  Seasonality           → operational
 *   V  Vendor Prohibits      → operational
 *   W  Warehouse Impact      → operational
 *   Y  Send Zero Inventory   → the actual suppression marker (operational)
 *
 * N is the important correction: it means "send inventory", i.e. the style is
 * live, NOT suppressed. Counting it as suppression previously inflated the ledger
 * by thousands of healthy styles. N is now excluded from all suppression buckets.
 */
export type SuppressionClass = "margin" | "operational" | "not_suppressed" | "unknown";

const FLAG_CLASS: Record<string, SuppressionClass> = suppressionCodes as Record<string, SuppressionClass>;

export function classifyFlags(flags: string): {
  margin: boolean;
  operational: boolean;
  notSuppressed: boolean;
  unknown: boolean;
  letters: string[];
} {
  const letters = (flags || "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .flatMap((chunk) => chunk.split("")) // "MQ" → M, Q
    .filter(Boolean);
  let margin = false;
  let operational = false;
  let notSuppressed = false;
  let unknown = false;
  for (const l of letters) {
    const cls = FLAG_CLASS[l] ?? "unknown";
    if (cls === "margin") margin = true;
    else if (cls === "operational") operational = true;
    else if (cls === "not_suppressed") notSuppressed = true;
    else unknown = true;
  }
  return { margin, operational, notSuppressed, unknown, letters: [...new Set(letters)] };
}

export interface SuppressionLedger {
  available: boolean;
  reason?: string;
  marginStyles: number;
  marginRevenue: number;
  operationalStyles: number;
  operationalRevenue: number;
  unknownStyles: number;
  unknownRevenue: number;
  unknownLetters: string[];
  rows: {
    style: string;
    letters: string[];
    class: SuppressionClass;
    revenue: number;
  }[];
}

/**
 * Panel 4 — suppression cost per Style. Reads amazon_price_file (flags) joined to
 * asin_style_map, then attaches Sales revenue from the aggregate (passed in so we
 * don't re-pull ARA here). Revenue is keyed by Style via the same map.
 *
 * `styleRevenue` maps Style → shipped revenue, assembled by the caller from the
 * aggregate + asin_style_map. Kept as an argument so this stays a pure BQ read.
 */
export async function suppressionLedger(
  styleRevenue: Map<string, number>
): Promise<SuppressionLedger> {
  const empty: SuppressionLedger = {
    available: false,
    marginStyles: 0,
    marginRevenue: 0,
    operationalStyles: 0,
    operationalRevenue: 0,
    unknownStyles: 0,
    unknownRevenue: 0,
    unknownLetters: [],
    rows: [],
  };

  if (!bigQueryEnabled()) {
    return { ...empty, reason: "BigQuery not configured (set BQ_PROJECT)." };
  }

  let flagRows: { style: string | null; send_zero_flags: string | null }[];
  try {
    flagRows = await query(
      `SELECT CAST(Style AS STRING) AS style,
              CAST(SendZeroFlags AS STRING) AS send_zero_flags
       FROM ${feedsTable(warehouse.tables.priceFile)}
       WHERE SendZeroFlags IS NOT NULL AND SendZeroFlags != ''`
    );
  } catch (e) {
    return { ...empty, reason: `${warehouse.tables.priceFile} read failed: ${(e as Error).message}` };
  }

  const rows: SuppressionLedger["rows"] = [];
  const unknownLetters = new Set<string>();
  let marginStyles = 0;
  let marginRevenue = 0;
  let operationalStyles = 0;
  let operationalRevenue = 0;
  let unknownStyles = 0;
  let unknownRevenue = 0;

  for (const fr of flagRows) {
    const style = (fr.style ?? "").trim();
    if (!style) continue;
    const c = classifyFlags(fr.send_zero_flags ?? "");

    // A style is only in the suppression ledger if it carries a real suppression
    // reason. N ("send inventory") is NOT suppression — a style flagged only N is
    // live and must be excluded entirely, not counted as unknown.
    if (!c.margin && !c.operational && !c.unknown) continue;

    const revenue = styleRevenue.get(style.toUpperCase()) ?? 0;
    // Precedence for the single-class label: margin is the headline cost.
    const cls: SuppressionClass = c.margin ? "margin" : c.operational ? "operational" : "unknown";

    if (c.margin) {
      marginStyles += 1;
      marginRevenue += revenue;
    }
    if (c.operational && !c.margin) {
      operationalStyles += 1;
      operationalRevenue += revenue;
    }
    if (c.unknown && !c.margin && !c.operational) {
      unknownStyles += 1;
      unknownRevenue += revenue;
      c.letters.forEach((l) => {
        if ((FLAG_CLASS[l] ?? "unknown") === "unknown") unknownLetters.add(l);
      });
    }

    rows.push({ style, letters: c.letters, class: cls, revenue });
  }

  rows.sort((a, b) => b.revenue - a.revenue);

  return {
    available: true,
    marginStyles,
    marginRevenue,
    operationalStyles,
    operationalRevenue,
    unknownStyles,
    unknownRevenue,
    unknownLetters: [...unknownLetters].sort(),
    rows: rows.slice(0, 500),
  };
}

// ─── Panel 5: fill risk (BigQuery) ───────────────────────────────────────────

export interface FillRisk {
  available: boolean;
  reason?: string;
  styles: {
    style: string;
    onHand: number;
    onOrder: number;
    inRoute: number;
    coverRatio: number | null; // onHand / onOrder
  }[];
  orderedVsShippedGapPct: number | null; // from the aggregate, passed in
}

/**
 * Panel 5 — supply position per Style from amazon_inventory, plus the
 * ordered-vs-shipped gap (computed by the caller from the aggregate). A clean gap
 * is shown precisely because it rules out a risk category at a glance.
 */
export async function fillRisk(orderedVsShippedGapPct: number | null): Promise<FillRisk> {
  if (!bigQueryEnabled()) {
    return { available: false, reason: "BigQuery not configured.", styles: [], orderedVsShippedGapPct };
  }

  try {
    const rows = await query<{
      style: string | null;
      on_hand: number | null;
      on_order: number | null;
      in_route: number | null;
    }>(
      `SELECT CAST(Style AS STRING) AS style,
              SAFE_CAST(QtyOnHand  AS FLOAT64) AS on_hand,
              SAFE_CAST(QtyOnOrder AS FLOAT64) AS on_order,
              SAFE_CAST(QtyInRoute AS FLOAT64) AS in_route
       FROM ${feedsTable(warehouse.tables.inventory)}`
    );

    const styles = rows
      .filter((r) => r.style)
      .map((r) => {
        const onHand = r.on_hand ?? 0;
        const onOrder = r.on_order ?? 0;
        return {
          style: r.style as string,
          onHand,
          onOrder,
          inRoute: r.in_route ?? 0,
          coverRatio: onOrder > 0 ? onHand / onOrder : null,
        };
      })
      // Most exposed first: low cover against real open orders.
      .sort((a, b) => (a.coverRatio ?? 999) - (b.coverRatio ?? 999));

    return { available: true, styles: styles.slice(0, 500), orderedVsShippedGapPct };
  } catch (e) {
    return {
      available: false,
      reason: `${warehouse.tables.inventory} read failed: ${(e as Error).message}`,
      styles: [],
      orderedVsShippedGapPct,
    };
  }
}

/**
 * Style → shipped revenue, via asin_style_map joined to the caller-supplied
 * per-ASIN revenue (from the aggregate). Pure BQ read of the bridge only.
 */
export async function styleRevenueFromMap(
  asinRevenue: Map<string, number>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!bigQueryEnabled() || asinRevenue.size === 0) return out;

  try {
    const rows = await query<{ asin: string | null; style: string | null }>(
      `SELECT CAST(ASIN AS STRING) AS asin, CAST(Style AS STRING) AS style
       FROM ${feedsTable(warehouse.tables.asinStyleMap)}`
    );
    for (const r of rows) {
      const asin = (r.asin ?? "").toUpperCase();
      const style = (r.style ?? "").toUpperCase();
      if (!asin || !style) continue;
      const rev = asinRevenue.get(asin);
      if (rev != null) out.set(style, (out.get(style) ?? 0) + rev);
    }
  } catch {
    // Bridge unavailable — Panel 4 revenue will be zero, which the UI notes.
  }
  return out;
}
