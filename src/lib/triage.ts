// Triage engine — the command center's data layer.
//
// This is the single most important design idea in the redesign: it does NOT
// compute anything new. It reads the structured output each domain module
// already produces — silent-CRaP verdicts, the margin floor gauge, the
// suppression ledger, confirmation rate, sales drags — and maps each into one
// common Signal shape, then ranks the whole set by severity and revenue impact.
//
// Because every number here comes from the same function the destination page
// uses, a signal can never disagree with the page it links to. Triage is a lens,
// not a source of truth.

import type { Aggregate } from "./types";
import type { ReferenceData } from "./reference";
import type { AraNetPpmData } from "./araNetPpm";
import { buildCrapReport } from "./crap";
import { buildConfirmationReport } from "./confirmation";
import { buildOverview } from "./overview";
import {
  floorGauge,
  brandCodeConcentration,
  repriceTargets,
  suppressionLedger,
  styleRevenueFromMap,
  NET_PPM_FLOOR,
} from "./riskMonitor";
import { bigQueryEnabled } from "./bigquery";

export type Severity = "action" | "watch" | "info";
export type Domain = "risk" | "sales" | "listings";

export interface Signal {
  id: string;
  severity: Severity;
  domain: Domain;
  icon: string; // tabler icon name
  title: string;
  detail: string;
  /** Revenue at stake, used purely for ranking within a severity band. */
  weight: number;
  /** Where clicking the signal goes — a route in the new domain structure. */
  href: string;
}

export interface TriageFeed {
  generatedAt: string;
  synced: string | null;
  counts: { action: number; watch: number; info: number };
  headline: {
    revenueAtRisk: number;
    floorHeadroomPts: number | null;
    suppressedForMargin: number | null;
    currency: string;
  };
  signals: Signal[];
  /** Data gaps that suppress signals — shown so the feed is honest about blind spots. */
  blindSpots: string[];
}

const SEV_RANK: Record<Severity, number> = { action: 0, watch: 1, info: 2 };

function money(n: number, currency: string): string {
  const abs = Math.abs(n);
  const s =
    abs >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : abs >= 1_000
        ? `${Math.round(n / 1_000)}K`
        : `${Math.round(n)}`;
  return `${currency === "USD" ? "$" : ""}${s}`;
}

export async function buildTriageFeed(
  agg: Aggregate | null,
  ref: ReferenceData | null,
  ara: AraNetPpmData | null
): Promise<TriageFeed> {
  const signals: Signal[] = [];
  const blindSpots: string[] = [];
  const currency = agg?.totals.sales.currency ?? "USD";

  let revenueAtRisk = 0;
  let floorHeadroomPts: number | null = null;
  let suppressedForMargin: number | null = null;

  // ── Revenue Risk domain ──

  // Silent CRaP (needs sales history with COGS).
  if (agg) {
    const crap = buildCrapReport(agg, ref, { weeks: 8 });
    const sc = crap.counts.silent_crap;
    if (sc > 0) {
      revenueAtRisk += crap.atRisk.shippedRevenue;
      signals.push({
        id: "crap-silent",
        severity: "action",
        domain: "risk",
        icon: "ti-alert-triangle",
        title: `${sc} ASIN${sc === 1 ? "" : "s"} silently CRaP'd`,
        detail: `Margin below floor, Amazon ordering less, no suppression of ours — ${money(
          crap.atRisk.shippedRevenue,
          currency
        )}`,
        weight: crap.atRisk.shippedRevenue,
        href: "/risk?panel=crap&verdict=silent_crap",
      });
    }
    const mw = crap.counts.margin_watch;
    if (mw > 0) {
      signals.push({
        id: "crap-watch",
        severity: "watch",
        domain: "risk",
        icon: "ti-eye",
        title: `${mw} ASIN${mw === 1 ? "" : "s"} on margin watch`,
        detail: "Below benchmark, but POs are holding — not bitten yet",
        weight: 0,
        href: "/risk?panel=crap&verdict=margin_watch",
      });
    }
    if (crap.notes.length > 0) blindSpots.push(...crap.notes);
  }

  // Margin floor + weak brand code (needs ARA CSV).
  if (ara?.rows.length) {
    const gauge = floorGauge(ara.rows);
    floorHeadroomPts = gauge.headroomPts;
    if (gauge.status === "red") {
      signals.push({
        id: "floor-blended",
        severity: "action",
        domain: "risk",
        icon: "ti-trending-down",
        title: "Blended Net PPM is below the floor",
        detail: `${((gauge.blendedNetPpm ?? 0) * 100).toFixed(1)}% vs ${(
          NET_PPM_FLOOR * 100
        ).toFixed(1)}% floor, revenue-weighted`,
        weight: gauge.revenue,
        href: "/risk?panel=monitor&section=floor",
      });
    }

    const worst = brandCodeConcentration(ara.rows)[0];
    if (worst && worst.status === "red") {
      signals.push({
        id: "brandcode-weak",
        severity: "action",
        domain: "risk",
        icon: "ti-chart-bar",
        title: `${worst.brandCode} code at ${((worst.netPpm ?? 0) * 100).toFixed(1)}% Net PPM`,
        detail: `Below floor — ${money(worst.revenue, currency)} of revenue on this code`,
        weight: worst.revenue,
        href: "/risk?panel=monitor&section=brandcode",
      });
    }

    const reprice = repriceTargets(ara.rows);
    if (reprice.count > 0) {
      signals.push({
        id: "reprice",
        severity: reprice.trend === "down" ? "action" : "watch",
        domain: "risk",
        icon: "ti-tag",
        title: `${reprice.count.toLocaleString()} ASINs below the floor`,
        detail: `${money(reprice.revenue, currency)} of revenue${
          reprice.trend === "down" ? ", trend worsening" : ""
        }`,
        weight: reprice.revenue,
        href: "/risk?panel=monitor&section=reprice",
      });
    }
  } else {
    blindSpots.push("Upload the ARA Net PPM export to see margin-floor signals.");
  }

  // Suppression ledger (needs BigQuery).
  if (agg && bigQueryEnabled()) {
    const asinRevenue = new Map<string, number>();
    for (const p of agg.products) {
      if (p.sales) asinRevenue.set(p.asin.toUpperCase(), p.sales.shippedRevenue);
    }
    const styleRevenue = await styleRevenueFromMap(asinRevenue);
    const ledger = await suppressionLedger(styleRevenue);
    if (ledger.available && ledger.marginRevenue > 0) {
      suppressedForMargin = ledger.marginRevenue;
      signals.push({
        id: "suppression-margin",
        severity: "watch",
        domain: "risk",
        icon: "ti-cash",
        title: `${money(ledger.marginRevenue, currency)} suppressed for margin`,
        detail: `${ledger.marginStyles} styles you're unlisting on the M flag — the cost of the policy`,
        weight: ledger.marginRevenue,
        href: "/risk?panel=monitor&section=suppression",
      });
    }
    if (ledger.unknownLetters.length > 0) {
      blindSpots.push(
        `SendZeroFlags ${ledger.unknownLetters.join(", ")} have no defined meaning yet.`
      );
    }
  } else if (agg) {
    blindSpots.push("Connect BigQuery (BQ_PROJECT) to see the suppression ledger and fill risk.");
  }

  // Confirmation rate (needs reference CSV joined to PO).
  if (agg && ref) {
    const conf = buildConfirmationReport(agg, ref, new Date().toISOString(), 8);
    const all = conf.segments.ALL;
    if (all?.confirmationRate != null && all.confirmationRate < 0.85) {
      signals.push({
        id: "confirmation-rate",
        severity: all.confirmationRate < 0.75 ? "action" : "watch",
        domain: "risk",
        icon: "ti-file-x",
        title: `Confirmation rate at ${(all.confirmationRate * 100).toFixed(0)}%`,
        detail: "Suppressed and declined lines dragging the accept rate",
        weight: 0,
        href: "/risk?panel=confirmation",
      });
    }
  }

  // ── Sales domain ──
  if (agg) {
    const overview = buildOverview(agg, 8);
    const drag = overview.leaderboards.topDrags[0];
    if (drag && drag.value < 0) {
      signals.push({
        id: "sales-drag",
        severity: "watch",
        domain: "sales",
        icon: "ti-arrow-down-right",
        title: `Top drag: ${drag.style10 ?? drag.title ?? drag.asin} ${money(drag.value, currency)}`,
        detail: drag.secondary ? `${drag.secondary} of the week's decline` : "Largest revenue decline",
        weight: Math.abs(drag.value),
        href: "/sales?view=drags",
      });
    }
  } else {
    blindSpots.push("Run a sync to populate sales signals.");
  }

  // ── Listings domain ──
  // Catalog degradation is a standing condition when the Product Listing role is
  // absent — surface it once as info so it's not mistaken for a fresh problem.
  if (agg) {
    const noType = agg.products.filter((p) => !p.productType).length;
    if (noType > 0 && noType === agg.products.length) {
      signals.push({
        id: "listings-role",
        severity: "info",
        domain: "listings",
        icon: "ti-alert-circle",
        title: "Catalog attributes are degraded",
        detail: "Product Listing role missing — product types are inferred from titles",
        weight: 0,
        href: "/listings",
      });
    }
  }

  // Rank: severity band first, then revenue weight within the band.
  signals.sort(
    (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.weight - a.weight
  );

  const counts = {
    action: signals.filter((s) => s.severity === "action").length,
    watch: signals.filter((s) => s.severity === "watch").length,
    info: signals.filter((s) => s.severity === "info").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    synced: agg?.meta?.generatedAt ?? null,
    counts,
    headline: { revenueAtRisk, floorHeadroomPts, suppressedForMargin, currency },
    signals,
    blindSpots: [...new Set(blindSpots)],
  };
}
