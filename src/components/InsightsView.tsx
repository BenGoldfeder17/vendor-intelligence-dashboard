"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { money, number, percent } from "@/lib/format";
import type { ProductInsight } from "@/lib/types";

interface InsightsResp {
  drivers: ProductInsight[];
  drags: ProductInsight[];
  currency: string;
  window: { start: string; end: string };
  empty?: boolean;
}

export default function InsightsView() {
  const [data, setData] = useState<InsightsResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/insights", { cache: "no-store" });
      setData(await r.json());
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="panel panel-pad subtle">Loading…</div>;
  if (!data || data.empty) {
    return (
      <div className="panel empty-state">
        <h2>No insights yet</h2>
        <p className="muted">Run a sync to compute Drags &amp; Drivers.</p>
      </div>
    );
  }

  return (
    <>
      <p className="subtle" style={{ marginBottom: 20 }}>
        Period-over-period shipped-revenue movement across the sales window ({data.window.start} →{" "}
        {data.window.end}). The window is split recent-half vs. prior-half; contribution is each
        ASIN&apos;s share of total positive (drivers) or negative (drags) movement.
      </p>
      <div className="two-col">
        <div>
          <h3 style={{ color: "var(--green)" }}>▲ Top Drivers ({data.drivers.length})</h3>
          <InsightTable rows={data.drivers.slice(0, 25)} currency={data.currency} positive />
        </div>
        <div>
          <h3 style={{ color: "var(--red)" }}>▼ Top Drags ({data.drags.length})</h3>
          <InsightTable rows={data.drags.slice(0, 25)} currency={data.currency} positive={false} />
        </div>
      </div>
    </>
  );
}

function InsightTable({
  rows,
  currency,
  positive,
}: {
  rows: ProductInsight[];
  currency: string;
  positive: boolean;
}) {
  if (!rows.length) return <div className="panel panel-pad subtle">None in this window.</div>;
  return (
    <div className="panel">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th className="num">Δ Revenue</th>
            <th className="num">Δ%</th>
            <th className="num">Δ Units</th>
            <th className="num">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.asin}>
              <td>
                <Link href={`/product/${r.asin}`}>{r.title ?? r.asin}</Link>
                <div className="subtle">
                  {r.style10 ? `${r.style10} · ` : ""}
                  {r.asin}
                </div>
              </td>
              <td className={`num ${positive ? "pos" : "neg"}`}>
                {positive ? "+" : ""}
                {money(r.deltaRevenue, currency)}
              </td>
              <td className={`num ${positive ? "pos" : "neg"}`}>{percent(r.deltaPct)}</td>
              <td className="num">
                {r.deltaUnits > 0 ? "+" : ""}
                {number(r.deltaUnits)}
              </td>
              <td className="num">{r.contributionPct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
