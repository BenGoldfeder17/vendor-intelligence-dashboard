"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LineChart } from "@/components/Charts";
import { useSyncStatus, SyncButton, SyncBar, NetErrorBanner } from "@/components/sync-ui";
import { useDateRange } from "@/components/DateRangeContext";
import { rangeParam, RANGES } from "@/components/RangePicker";
import CmpRow, { pctVal } from "@/components/CmpRow";
import { compactMoney, money, number, percent } from "@/lib/format";
import type { OverviewData, LeaderRow } from "@/lib/overview";
import type { PoSums } from "@/lib/poWindow";
import type { SalesPoint } from "@/lib/types";

type Grain = "day" | "week" | "month";

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [empty, setEmpty] = useState(false);
  const [grain, setGrain] = useState<Grain>("week");
  const [loading, setLoading] = useState(true);
  const { periods, compare } = useDateRange();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/overview?months=${rangeParam(periods)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.empty) setEmpty(true);
      else {
        setData(json as OverviewData);
        setEmpty(false);
      }
    } catch {
      /* surfaced via sync banner */
    } finally {
      setLoading(false);
    }
  }, [periods]);

  const { status, netError, triggerSync } = useSyncStatus(load);
  useEffect(() => {
    void load();
  }, [load]);

  const sales = useMemo(() => resample(data?.salesByDate ?? [], grain), [data, grain]);

  if (loading && !data) {
    return (
      <>
        <Header status={status} onSync={triggerSync} meta={null} win={null} />
        <NetErrorBanner message={netError} />
        <SyncBar status={status} />
        <div className="panel panel-pad subtle">Loading…</div>
      </>
    );
  }

  if (empty || !data) {
    return (
      <>
        <Header status={status} onSync={triggerSync} meta={null} win={null} />
        <NetErrorBanner message={netError} />
        <SyncBar status={status} />
        <div className="panel empty-state">
          <h2>No data yet</h2>
          <p className="muted">Run a sync to aggregate sales, forecast, and purchase-order economics.</p>
          <button className="btn" onClick={triggerSync} style={{ marginTop: 12 }}>
            Run first sync
          </button>
        </div>
      </>
    );
  }

  const k = data.kpis;

  return (
    <>
      <Header status={status} onSync={triggerSync} meta={data.meta} win={data.salesWindow} />
      <NetErrorBanner message={netError} />
      <SyncBar status={status} />

      <div className="kpis">
        <Kpi label="Shipped Revenue" value={money(k.shippedRevenue, k.currency)} />
        <Kpi label="Ordered Revenue" value={money(k.orderedRevenue, k.currency)} />
        <Kpi label="Shipped Units" value={number(k.shippedUnits)} />
        <Kpi
          label="Customer Returns"
          value={number(k.customerReturns)}
          sub={k.returnRate != null ? `${percent(k.returnRate)} of shipped` : undefined}
        />
        <Kpi label="Forecast Units" value={number(Math.round(k.forecastUnitsHorizon))} sub="horizon total" />
        <Kpi label="Avg Markup" value={k.avgMarkupPct != null ? `${k.avgMarkupPct.toFixed(1)}%` : "—"} />
        <Kpi label="ASINs" value={number(k.asinCount)} sub={`${number(k.asinsWithSales)} with sales`} />
        <Kpi label="PO Net Cost (all-time)" value={compactMoney(k.totalPONetCost, k.currency)} sub={`${number(k.asinsWithCost)} ASINs`} />
      </div>

      {data.po && <PoWindowSection po={data.po} compare={compare} currency={k.currency} />}

      <div className="overview-grid">
        <div className="panel">
          <div className="card-head">
            <h2>Portfolio Revenue Trend</h2>
            <div className="segmented">
              {(["day", "week", "month"] as Grain[]).map((g) => (
                <button key={g} className={g === grain ? "active" : ""} onClick={() => setGrain(g)}>
                  {g[0].toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-pad">
            <div className="legend">
              <span><span className="swatch" style={{ background: "var(--accent)" }} />Shipped</span>
              <span><span className="swatch" style={{ background: "var(--accent-2)" }} />Ordered</span>
            </div>
            {sales.length ? (
              <LineChart
                labels={sales.map((p) => p.date)}
                series={[
                  { name: "Shipped", color: "var(--accent)", values: sales.map((p) => p.shippedRevenue) },
                  { name: "Ordered", color: "var(--accent-2)", values: sales.map((p) => p.orderedRevenue) },
                ]}
                yLabel={`Revenue (${k.currency})`}
              />
            ) : (
              <p className="subtle">No sales series.</p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="card-head">
            <h2>Forecast Outlook</h2>
            <span className="subtle">total mean units / week</span>
          </div>
          <div className="panel-pad">
            <div className="legend">
              <span><span className="swatch" style={{ background: "var(--green)" }} />Forecast units</span>
            </div>
            {data.forecastByWeek.length ? (
              <LineChart
                labels={data.forecastByWeek.map((p) => p.date)}
                series={[{ name: "Forecast", color: "var(--green)", values: data.forecastByWeek.map((p) => p.meanUnits) }]}
                yLabel="Units"
              />
            ) : (
              <p className="subtle">No forecast data.</p>
            )}
          </div>
        </div>
      </div>

      <hr className="rule" />

      <h2 style={{ marginBottom: 16 }}>Leaderboards</h2>
      <div className="leaderboards">
        <Board title="Top Sellers (shipped revenue)" rows={data.leaderboards.topRevenue} fmt={(v) => money(v, k.currency)} />
        <Board title="Highest Amazon Markup" rows={data.leaderboards.topMarkup} fmt={(v) => `${v.toFixed(1)}%`} />
        <Board title="Top Drivers (Δ revenue)" rows={data.leaderboards.topDrivers} fmt={(v) => `+${money(v, k.currency)}`} positive />
        <Board title="Top Drags (Δ revenue)" rows={data.leaderboards.topDrags} fmt={(v) => money(v, k.currency)} negative />
        <Board title="Most Returns" rows={data.leaderboards.topReturns} fmt={(v) => number(v)} />
      </div>
    </>
  );
}

function Header({
  status,
  onSync,
  meta,
  win,
}: {
  status: ReturnType<typeof useSyncStatus>["status"];
  onSync: () => void;
  meta: OverviewData["meta"] | null;
  win: OverviewData["salesWindow"] | null;
}) {
  const label = win ? RANGES.find((r) => r.months === win.periods)?.label ?? "Custom" : null;

  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <div>
        <h1>Overview</h1>
        <p className="subtle">
          {meta && win ? (
            <>
              <strong>{label}</strong>
              {win.start && win.end ? ` · ${win.start} → ${win.end}` : ""}
              {" · "}
              {win.isFull && win.periods != null ? (
                <span title="Your selection is wider than the sales data that has been synced.">
                  all {win.totalPoints} period{win.totalPoints === 1 ? "" : "s"} synced
                </span>
              ) : (
                `${win.points} of ${win.totalPoints} periods`
              )}
              {` · synced ${new Date(meta.generatedAt).toLocaleString()}`}
            </>
          ) : (
            "Portfolio analytics across your Vendor Central catalog."
          )}
        </p>
      </div>
      <SyncButton status={status} onSync={onSync} />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function PoWindowSection({
  po,
  compare,
  currency,
}: {
  po: NonNullable<OverviewData["po"]>;
  compare: boolean;
  currency: string;
}) {
  const c = po.current;
  const label = RANGES.find((r) => r.months === po.window.months)?.label ?? "All";
  const rangeStr = po.window.current.length
    ? `${po.window.current[0]} → ${po.window.current[po.window.current.length - 1]}`
    : "all history";
  const rate = (s: PoSums) => (s.orderedUnits > 0 ? s.acceptedUnits / s.orderedUnits : null);
  const showCompare = compare && po.prior;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Purchase Orders · {label}</h2>
        <span className="subtle">
          {rangeStr}
          {showCompare && po.window.prior.length
            ? ` vs prior ${po.window.prior[0]} → ${po.window.prior[po.window.prior.length - 1]}`
            : ""}
        </span>
      </div>
      {showCompare ? (
        <div className="panel">
          <table className="cmp-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Previous</th>
                <th className="num">Current</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              <CmpRow label="Ordered units" prior={po.prior!.orderedUnits} cur={c.orderedUnits} />
              <CmpRow label="Accepted units" prior={po.prior!.acceptedUnits} cur={c.acceptedUnits} higherIsBetter />
              <CmpRow label="Cancelled units" prior={po.prior!.cancelledUnits} cur={c.cancelledUnits} higherIsBetter={false} />
              <CmpRow label="Confirmation rate" prior={pctVal(rate(po.prior!))} cur={pctVal(rate(c))} suffix="%" higherIsBetter />
              <CmpRow label="Cancelled $" prior={po.prior!.cancelledValue} cur={c.cancelledValue} currency={currency} higherIsBetter={false} />
              <CmpRow label="Accepted $" prior={po.prior!.acceptedValue} cur={c.acceptedValue} currency={currency} higherIsBetter />
            </tbody>
          </table>
        </div>
      ) : (
        <div className="kpis" style={{ marginBottom: 0 }}>
          <Kpi label="Ordered Units" value={number(c.orderedUnits)} />
          <Kpi label="Accepted" value={number(c.acceptedUnits)} />
          <Kpi label="Cancelled" value={number(c.cancelledUnits)} />
          <Kpi label="Confirmation Rate" value={rate(c) != null ? `${(rate(c)! * 100).toFixed(1)}%` : "—"} />
          <Kpi label="Cancelled $" value={compactMoney(c.cancelledValue, currency)} />
        </div>
      )}
    </div>
  );
}

function Board({
  title,
  rows,
  fmt,
  positive,
  negative,
}: {
  title: string;
  rows: LeaderRow[];
  fmt: (v: number) => string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="panel">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      {rows.length ? (
        <table>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.asin}>
                <td className="muted" style={{ width: 1 }}>{i + 1}</td>
                <td>
                  <Link href={`/product/${r.asin}`}>{r.title ?? r.asin}</Link>
                  <div className="subtle">
                    {r.style10 ? `${r.style10} · ` : ""}
                    {r.asin}
                    {r.secondary ? ` · ${r.secondary}` : ""}
                  </div>
                </td>
                <td className={`num ${positive ? "pos" : negative ? "neg" : ""}`}>{fmt(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="panel-pad subtle">No data.</div>
      )}
    </div>
  );
}

/** Resample a daily series into day/week/month buckets (summing metrics). */
function resample(daily: SalesPoint[], grain: Grain): SalesPoint[] {
  if (grain === "day") return daily;
  const m = new Map<string, SalesPoint>();
  for (const p of daily) {
    const key = grain === "month" ? monthStart(p.date) : weekStart(p.date);
    const e = m.get(key);
    if (!e) m.set(key, { ...p, date: key });
    else {
      e.shippedUnits += p.shippedUnits;
      e.shippedRevenue += p.shippedRevenue;
      e.orderedUnits += p.orderedUnits;
      e.orderedRevenue += p.orderedRevenue;
      e.customerReturns += p.customerReturns;
    }
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function monthStart(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

function weekStart(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun
  const offset = day === 0 ? 6 : day - 1; // back to Monday
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
