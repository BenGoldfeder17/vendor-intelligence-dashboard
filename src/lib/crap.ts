// Silent CRaP detector.
//
// The three-lane classifier only ever sees POs that ARRIVE. But Amazon's PO
// engine is margin-filtered: it reduces order quantities for low-margin ASINs
// and can stop buying them altogether. A CRaP-out therefore produces no PO line
// to classify — it's silence, not a rejection. That silence is invisible to the
// lane logic, and it means PO volume is demand *after* Amazon's margin screen,
// not demand.
//
// This module sits BESIDE the lane classifier and looks for that silence:
// margin below benchmark + PO velocity decaying + no suppression of our own.
//
// ── Two honest caveats about the margin number ──
//
// 1. This is GROSS PPM: (shippedRevenue − shippedCogs) / shippedRevenue, derived
//    from GET_VENDOR_SALES_REPORT. It is NOT Amazon's "Net PPM", which also folds
//    in vendor terms and subtracts sales discounts. Directionally the same signal;
//    not the same number. Treated as a proxy, and labelled as one.
//
// 2. The marketplace's own Net PPM uses an ESTIMATED contra-COGS, so its figure
//    isn't authoritative either. Because the real contracted allowances per
//    vendor code live in app.config.ts, this module computes a CORRECTED Net PPM
//    from them — see `correctedNetPpm` below. That figure is more accurate than
//    the marketplace's, which is a genuinely useful position going into a
//    negotiation.

import type { Aggregate, SalesPoint } from "./types";
import type { ReferenceData } from "./reference";
import { cancelCodes } from "./reference";
import { thresholds, identity, contractFor, totalAllowancePct } from "@/config/app.config";

/** Amazon's healthy Net PPM benchmarks: softlines >35%, hardlines >40%. */
export const DEFAULT_BENCHMARK = thresholds.marginBenchmark;
/** A PO drop this steep, week-over-week window, counts as decay. */
export const DEFAULT_DECAY = thresholds.poDecayThreshold;

export type Verdict =
  | "silent_crap"
  | "self_suppressed"
  | "margin_watch"
  | "healthy"
  | "thin_data";

export interface CrapRow {
  asin: string;
  style: string | null;
  title: string | null;
  brand: string | null;

  // ── margin, recent window ──
  shippedUnits: number;
  shippedRevenue: number;
  shippedCogs: number;
  asp: number | null;
  unitCost: number | null;
  /** Gross PPM proxy — see the caveat at the top of this file. */
  ppm: number | null;
  /**
   * Corrected NET PPM: gross margin plus the allowances actually contracted for
   * this product's vendor code. Null when no contract terms are configured.
   */
  netPpmCorrected: number | null;
  /** Total contracted allowances applied, as a fraction of revenue. */
  allowancePct: number | null;
  /** The vendor code's contracted floor, for a like-for-like comparison. */
  contractFloor: number | null;
  /** True when the corrected margin sits below this code's contracted floor. */
  belowContractFloor: boolean;

  // ── margin, prior window ──
  ppmPrior: number | null;
  ppmDelta: number | null;

  belowBenchmark: boolean;

  // ── PO velocity (weekly buckets, same weeks as the sales window) ──
  poRecent: number;
  poPrior: number;
  /** Fractional change in ordered units. −0.4 = Amazon ordered 40% fewer. */
  poDecay: number | null;

  // ── our own actions, from the reference table ──
  code: string | null;
  suppressed: boolean;
  onHand: number | null;

  // ── self-undercut check (only when the reference carries a web price) ──
  webUnitPrice: number | null;
  undercut: boolean;

  verdict: Verdict;
  currency: string;
}

export interface CrapReport {
  /** The weeks that make up each half of the comparison. */
  window: { recent: string[]; prior: string[]; weeks: number };
  benchmark: number;
  decayThreshold: number;
  currency: string;

  counts: Record<Verdict, number>;

  /** Revenue and PO value sitting in the silent-CRaP bucket. */
  atRisk: { asins: number; shippedRevenue: number; poUnitsLost: number };

  /** Portfolio margin. */
  portfolio: { ppm: number | null; asp: number | null; unitCost: number | null };

  rows: CrapRow[];

  /** Why the answer might be untrustworthy. */
  notes: string[];
}

interface Sums {
  units: number;
  revenue: number;
  cogs: number;
}

function zero(): Sums {
  return { units: 0, revenue: 0, cogs: 0 };
}

function add(s: Sums, p: SalesPoint): void {
  s.units += p.shippedUnits;
  s.revenue += p.shippedRevenue;
  s.cogs += p.shippedCogs;
}

function ppmOf(s: Sums): number | null {
  if (s.revenue <= 0) return null;
  return (s.revenue - s.cogs) / s.revenue;
}

/**
 * Corrected NET PPM for a vendor code.
 *
 * The marketplace deducts contracted allowances from what it pays you (co-op,
 * prompt-pay discount, damage, freight, returns). Those deductions lower ITS
 * effective cost, so its net margin sits ABOVE the gross margin by the total
 * allowance percentage:
 *
 *     netPPM ≈ grossPPM + totalAllowancePct
 *
 * The marketplace publishes a Net PPM built on an ESTIMATE of those allowances.
 * Using the real contracted figures gives a truer number than it reports.
 *
 * Returns null when nothing is contracted, so the UI can distinguish
 * "no allowances configured" from "allowances are genuinely zero".
 */
function correctedNetPpm(
  grossPpm: number | null,
  vendorCode: string | null
): { corrected: number | null; allowancePct: number | null; floor: number } {
  const terms = contractFor(vendorCode);
  const allowance = totalAllowancePct(terms);
  if (grossPpm == null) return { corrected: null, allowancePct: allowance || null, floor: terms.floor };
  if (allowance <= 0) return { corrected: null, allowancePct: null, floor: terms.floor };
  return { corrected: grossPpm + allowance, allowancePct: allowance, floor: terms.floor };
}

/**
 * Split the tail of the sales series into two equal halves.
 * `weeks` is the size of EACH half, so 8 compares the last 8 weeks with the 8 before.
 */
function splitWeeks(all: string[], weeks: number): { recent: string[]; prior: string[] } {
  const sorted = [...all].sort();
  const recent = sorted.slice(Math.max(0, sorted.length - weeks));
  const prior = sorted.slice(Math.max(0, sorted.length - weeks * 2), Math.max(0, sorted.length - weeks));
  return { recent, prior };
}

/** Ordered units from the compact weekly PO array: index 0 is orderedUnits. */
function poUnits(poWeekly: Record<string, number[]> | undefined, weeks: string[]): number {
  if (!poWeekly) return 0;
  let n = 0;
  for (const w of weeks) n += poWeekly[w]?.[0] ?? 0;
  return n;
}

export interface CrapOptions {
  /** Size of each half-window, in weeks. */
  weeks?: number;
  benchmark?: number;
  decayThreshold?: number;
  /** Ignore ASINs below this many shipped units — too noisy to judge. */
  minUnits?: number;
}

export function buildCrapReport(
  agg: Aggregate,
  ref: ReferenceData | null,
  opts: CrapOptions = {}
): CrapReport {
  const weeks = Math.max(1, opts.weeks ?? 8);
  const benchmark = opts.benchmark ?? DEFAULT_BENCHMARK;
  const decayThreshold = opts.decayThreshold ?? DEFAULT_DECAY;
  const minUnits = opts.minUnits ?? 1;
  const currency = agg.totals.sales.currency;

  // Every week present in the sales series, across the portfolio.
  const weekSet = new Set<string>();
  for (const p of agg.products) for (const s of p.salesSeries) weekSet.add(s.date);
  const { recent, prior } = splitWeeks([...weekSet], weeks);
  const recentSet = new Set(recent);
  const priorSet = new Set(prior);

  const refByAsin = new Map(
    (ref?.rows ?? []).map((r) => [r.asin.toUpperCase(), r])
  );

  const counts: Record<Verdict, number> = {
    silent_crap: 0,
    self_suppressed: 0,
    margin_watch: 0,
    healthy: 0,
    thin_data: 0,
  };

  const portfolioRecent = zero();
  const atRisk = { asins: 0, shippedRevenue: 0, poUnitsLost: 0 };
  const rows: CrapRow[] = [];

  for (const p of agg.products) {
    const r = zero();
    const q = zero();
    for (const s of p.salesSeries) {
      if (recentSet.has(s.date)) add(r, s);
      else if (priorSet.has(s.date)) add(q, s);
    }
    add(portfolioRecent, {
      date: "",
      shippedUnits: r.units,
      shippedRevenue: r.revenue,
      shippedCogs: r.cogs,
      orderedUnits: 0,
      orderedRevenue: 0,
      customerReturns: 0,
    });

    const ppm = ppmOf(r);
    const ppmPrior = ppmOf(q);
    const poRecent = poUnits(p.poMonthly, recent);
    const poPrior = poUnits(p.poMonthly, prior);
    const poDecay = poPrior > 0 ? (poRecent - poPrior) / poPrior : null;

    const refRow = refByAsin.get(p.asin.toUpperCase());
    const code = refRow?.code ?? null;
    const suppressed = cancelCodes(code).length > 0;

    // Self-undercut: our own web price, normalized per unit, below Amazon's ASP.
    // Amazon matches the lowest advertised price it can find — including ours.
    const asp = r.units > 0 ? r.revenue / r.units : null;
    const unitCost = r.units > 0 ? r.cogs / r.units : null;
    const webUnitPrice =
      refRow?.webPrice != null && refRow.webPrice > 0
        ? refRow.webPrice / Math.max(1, refRow.packSize ?? 1)
        : null;
    const undercut = webUnitPrice != null && asp != null && webUnitPrice < asp;

    const belowBenchmark = ppm != null && ppm < benchmark;
    const decayed = poDecay != null && poDecay <= decayThreshold;

    // Corrected NET margin from the real contract terms for this product's
    // vendor code, compared against that code's own floor.
    const { corrected, allowancePct, floor: contractFloor } = correctedNetPpm(ppm, p.brand);
    const belowContractFloor = corrected != null && corrected < contractFloor;

    let verdict: Verdict;
    if (r.units < minUnits && poRecent === 0 && poPrior === 0) {
      verdict = "thin_data";
    } else if (decayed && suppressed) {
      // Amazon ordered less, but we told it to — this is Lane 3 working.
      verdict = "self_suppressed";
    } else if (decayed && belowBenchmark && !suppressed) {
      // Amazon quietly stopped buying and we never asked it to. This is the case
      // the lane classifier cannot see.
      verdict = "silent_crap";
    } else if (belowBenchmark) {
      verdict = "margin_watch";
    } else {
      verdict = "healthy";
    }
    counts[verdict] += 1;

    if (verdict === "silent_crap") {
      atRisk.asins += 1;
      atRisk.shippedRevenue += r.revenue;
      atRisk.poUnitsLost += Math.max(0, poPrior - poRecent);
    }

    rows.push({
      asin: p.asin,
      style: p.style10 ?? p.style,
      title: p.title,
      brand: p.brand,
      shippedUnits: r.units,
      shippedRevenue: r.revenue,
      shippedCogs: r.cogs,
      asp,
      unitCost,
      ppm,
      netPpmCorrected: corrected,
      allowancePct,
      contractFloor,
      belowContractFloor,
      ppmPrior,
      ppmDelta: ppm != null && ppmPrior != null ? ppm - ppmPrior : null,
      belowBenchmark,
      poRecent,
      poPrior,
      poDecay,
      code,
      suppressed,
      onHand: refRow?.onHand ?? null,
      webUnitPrice,
      undercut,
      verdict,
      currency,
    });
  }

  // Worst first: silent CRaP, then by revenue at stake.
  const order: Record<Verdict, number> = {
    silent_crap: 0,
    margin_watch: 1,
    self_suppressed: 2,
    healthy: 3,
    thin_data: 4,
  };
  rows.sort(
    (a, b) => order[a.verdict] - order[b.verdict] || b.shippedRevenue - a.shippedRevenue
  );

  // ── Be loud about why this might be wrong ──
  const notes: string[] = [];
  if (weekSet.size < weeks * 2) {
    notes.push(
      `Only ${weekSet.size} week(s) of sales data are synced, but this comparison needs ${
        weeks * 2
      }. Raise SALES_MAX_REPORTS and re-sync — until then the decay signal is meaningless.`
    );
  }
  if (portfolioRecent.cogs === 0 && portfolioRecent.revenue > 0) {
    notes.push(
      "GET_VENDOR_SALES_REPORT returned no shippedCogs, so no margin can be computed. " +
        "Check that the report includes the COGS column for this account."
    );
  }
  if (!ref) {
    notes.push(
      "No reference table loaded, so nothing can be separated into 'we suppressed it' vs " +
        "'Amazon stopped buying it'. Upload the ASIN/Code CSV."
    );
  }
  if (!(ref?.rows ?? []).some((r) => r.webPrice != null)) {
    notes.push(
      "Add a Web Price column (and Pack Size, if the web price isn't per-unit) to the reference " +
        `CSV to check whether ${identity.dtcSiteName} is undercutting the marketplace ASP.`
    );
  }

  return {
    window: { recent, prior, weeks },
    benchmark,
    decayThreshold,
    currency,
    counts,
    atRisk,
    portfolio: {
      ppm: ppmOf(portfolioRecent),
      asp: portfolioRecent.units > 0 ? portfolioRecent.revenue / portfolioRecent.units : null,
      unitCost: portfolioRecent.units > 0 ? portfolioRecent.cogs / portfolioRecent.units : null,
    },
    rows,
    notes,
  };
}
