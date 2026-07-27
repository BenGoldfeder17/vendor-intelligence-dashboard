// "Drags and Drivers" — Vendor Central's sales-diagnostic concept.
// We split each ASIN's sales window into a recent half and a prior half, measure
// the revenue/unit movement, and rank the biggest positive contributors
// (drivers) and biggest negative contributors (drags), with each item's share of
// the total movement so the list reads like Vendor Central's insight panel.

import type { Product, ProductInsight, SalesPoint } from "./types";

const FLAT_THRESHOLD = 0.02; // <2% change counts as flat

export function computeInsights(products: Product[]): {
  drivers: ProductInsight[];
  drags: ProductInsight[];
} {
  const raw: ProductInsight[] = [];

  for (const p of products) {
    const series = p.salesSeries;
    if (!series.length) continue;

    const mid = Math.floor(series.length / 2);
    // With an even split, prior = first half, current = second half.
    const priorRows = series.slice(0, mid);
    const currentRows = series.slice(mid);

    const priorRevenue = sum(priorRows, (r) => r.shippedRevenue);
    const currentRevenue = sum(currentRows, (r) => r.shippedRevenue);
    const priorUnits = sum(priorRows, (r) => r.shippedUnits);
    const currentUnits = sum(currentRows, (r) => r.shippedUnits);

    const deltaRevenue = currentRevenue - priorRevenue;
    const deltaUnits = currentUnits - priorUnits;
    const deltaPct = priorRevenue > 0 ? deltaRevenue / priorRevenue : currentRevenue > 0 ? 1 : null;

    const kind: ProductInsight["kind"] =
      deltaPct != null && Math.abs(deltaPct) < FLAT_THRESHOLD
        ? "flat"
        : deltaRevenue > 0
          ? "driver"
          : deltaRevenue < 0
            ? "drag"
            : "flat";

    raw.push({
      asin: p.asin,
      title: p.title,
      style10: p.style10,
      currentRevenue,
      priorRevenue,
      deltaRevenue,
      deltaPct,
      currentUnits,
      priorUnits,
      deltaUnits,
      contributionPct: 0, // filled below
      kind,
    });
  }

  const totalUp = raw.filter((r) => r.deltaRevenue > 0).reduce((a, r) => a + r.deltaRevenue, 0);
  const totalDown = Math.abs(
    raw.filter((r) => r.deltaRevenue < 0).reduce((a, r) => a + r.deltaRevenue, 0)
  );

  for (const r of raw) {
    if (r.deltaRevenue > 0 && totalUp > 0) r.contributionPct = (r.deltaRevenue / totalUp) * 100;
    else if (r.deltaRevenue < 0 && totalDown > 0)
      r.contributionPct = (Math.abs(r.deltaRevenue) / totalDown) * 100;
  }

  // Attach the insight back onto each product for the detail view.
  const byAsin = new Map(raw.map((r) => [r.asin, r]));
  for (const p of products) p.insight = byAsin.get(p.asin) ?? null;

  const drivers = raw
    .filter((r) => r.kind === "driver")
    .sort((a, b) => b.deltaRevenue - a.deltaRevenue);
  const drags = raw
    .filter((r) => r.kind === "drag")
    .sort((a, b) => a.deltaRevenue - b.deltaRevenue);

  return { drivers, drags };
}

function sum(rows: SalesPoint[], pick: (r: SalesPoint) => number): number {
  return rows.reduce((a, r) => a + (pick(r) ?? 0), 0);
}
