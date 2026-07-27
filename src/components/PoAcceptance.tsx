"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSyncStatus, SyncButton, SyncBar, NetErrorBanner } from "@/components/sync-ui";
import { rangeParam } from "@/components/RangePicker";
import CmpRow, { pctVal } from "@/components/CmpRow";
import { compactMoney, number, percent } from "@/lib/format";
import type { PoAcceptance as PoTotals } from "@/lib/types";

interface Row {
  asin: string;
  title: string | null;
  style10: string | null;
  thumbnail: string | null;
  ordered: number;
  accepted: number;
  cancelled: number;
  unconfirmed: number;
  downcounted: number;
  received: number;
  open: number;
  cancelledValue: number;
  currency: string;
  acceptRate: number | null;
}

interface PoResponse {
  meta: { generatedAt: string } | null;
  po: { totals: PoTotals; poCount: number; window: { start: string; end: string } } | null;
  range?: { months: number | null; available: string[]; current: string[]; prior: string[] };
  prior?: PoTotals | null;
  byAsin: Row[];
}

type SortKey = "cancelled" | "ordered" | "acceptRate" | "cancelledValue" | "received" | "open";

export default function PoAcceptance({ months, compare }: { months: number | null; compare: boolean }) {
  const [data, setData] = useState<PoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("cancelled");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/po?months=${rangeParam(months)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as PoResponse);
    } catch {
      /* surfaced via sync banner */
    } finally {
      setLoading(false);
    }
  }, [months]);

  const { status, netError, triggerSync } = useSyncStatus(load);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const list = (data?.byAsin ?? []).filter((r) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [r.asin, r.style10, r.title].filter(Boolean).some((f) => f!.toLowerCase().includes(q));
    });
    return [...list].sort((a, b) => {
      switch (sort) {
        case "ordered":
          return b.ordered - a.ordered;
        case "acceptRate":
          return (a.acceptRate ?? 1) - (b.acceptRate ?? 1); // worst first
        case "cancelledValue":
          return b.cancelledValue - a.cancelledValue;
        case "received":
          return b.received - a.received;
        case "open":
          return b.open - a.open;
        default:
          return b.cancelled - a.cancelled;
      }
    });
  }, [data, sort, query]);

  const po = data?.po;
  const t = po?.totals;
  const cur = t?.currency ?? "USD";
  const acceptRate = t && t.orderedUnits > 0 ? t.acceptedUnits / t.orderedUnits : null;
  const cancelRate = t && t.orderedUnits > 0 ? t.cancelledUnits / t.orderedUnits : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1>PO Acceptance</h1>
          <p className="subtle">
            {po
              ? `${number(po.poCount)} purchase orders · ${number(t!.lines)} line items · window ${po.window.start} → ${po.window.end}`
              : "How much of Amazon's ordered quantity you accepted vs. cancelled."}
          </p>
        </div>
        <SyncButton status={status} onSync={triggerSync} />
      </div>

      <NetErrorBanner message={netError} />
      <SyncBar status={status} />

      {!po ? (
        !loading && (
          <div className="panel empty-state">
            <h2>No PO acceptance data</h2>
            <p className="muted">Run a sync to pull purchase-order status from the Vendor Orders API.</p>
            <button className="btn" onClick={triggerSync} style={{ marginTop: 12 }}>
              Run sync
            </button>
          </div>
        )
      ) : (
        <>
          <p className="subtle" style={{ margin: "0 0 14px" }}>
            {data?.range?.current?.length
              ? `Window ${data.range.current[0]} → ${data.range.current[data.range.current.length - 1]}`
              : "All available history"}
            {compare && data?.prior && data.range?.prior?.length
              ? ` · compared to ${data.range.prior[0]} → ${data.range.prior[data.range.prior.length - 1]}`
              : ""}
          </p>

          {compare && data?.prior ? (
            <PoCompareTable cur={t!} prior={data.prior} currency={cur} />
          ) : (
            <div className="kpis">
              <Kpi label="Ordered Units" value={number(t!.orderedUnits)} />
              <Kpi label="Accepted" value={number(t!.acceptedUnits)} sub={acceptRate != null ? `${percent(acceptRate)} of ordered` : undefined} />
              <Kpi label="Cancelled" value={number(t!.cancelledUnits)} sub={cancelRate != null ? `${percent(cancelRate)} of ordered` : undefined} />
              <Kpi label="Confirmation Rate" value={acceptRate != null ? `${(acceptRate * 100).toFixed(1)}%` : "—"} />
              <Kpi label="Received" value={number(t!.receivedUnits)} />
              <Kpi
                label="Open (acc−rcvd)"
                value={number(Math.max(0, t!.acceptedUnits - t!.receivedUnits))}
                sub="accepted, not received"
              />
              <Kpi label="Cancelled Value" value={compactMoney(t!.cancelledValue, cur)} sub="net cost lost" />
            </div>
          )}

          <div className="panel panel-pad" style={{ marginBottom: 20 }}>
            <h3>Ordered units breakdown</h3>
            <StackBar totals={t!} />
            <p className="subtle" style={{ marginTop: 10 }}>
              <b>Open</b> = accepted but not yet received ({number(Math.max(0, t!.acceptedUnits - t!.receivedUnits))} units) —
              in-transit, unshipped, or effectively backordered. Downcounted: {number(t!.downcountedUnits)} units (Amazon
              reductions after order). The Vendor Orders status API has no explicit <b>backordered</b> field — a backordered
              acknowledgement is reported as accepted, so &quot;Open&quot; is the closest available proxy.
            </p>
          </div>

          <div className="controls">
            <input
              type="search"
              placeholder="Search ASIN, Style10, title…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="cancelled">Sort: Most cancelled units</option>
              <option value="cancelledValue">Sort: Most cancelled value</option>
              <option value="acceptRate">Sort: Lowest accept rate</option>
              <option value="open">Sort: Most open (accepted, not received)</option>
              <option value="ordered">Sort: Most ordered</option>
              <option value="received">Sort: Most received</option>
            </select>
            <span className="spacer" />
            <span className="subtle">{number(rows.length)} ASINs with POs</span>
          </div>

          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Ordered</th>
                  <th className="num">Accepted</th>
                  <th className="num">Cancelled</th>
                  <th className="num">Accept&nbsp;%</th>
                  <th className="num">Received</th>
                  <th className="num">Open</th>
                  <th className="num">Cancelled $</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.asin}>
                    <td>
                      <Link href={`/product/${r.asin}`}>{r.title ?? r.asin}</Link>
                      <div className="subtle">
                        {r.style10 ? `${r.style10} · ` : ""}
                        {r.asin}
                      </div>
                    </td>
                    <td className="num">{number(r.ordered)}</td>
                    <td className="num pos">{number(r.accepted)}</td>
                    <td className="num neg">{number(r.cancelled)}</td>
                    <td className="num">
                      {r.acceptRate != null ? `${(r.acceptRate * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="num">{number(r.received)}</td>
                    <td className="num">{number(r.open)}</td>
                    <td className="num">{compactMoney(r.cancelledValue, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 500 && (
            <p className="subtle" style={{ marginTop: 12, textAlign: "center" }}>
              Showing first 500 of {number(rows.length)} — search to narrow.
            </p>
          )}
        </>
      )}
    </>
  );
}

/** Expanded "previous vs current" comparison for the portfolio. */
function PoCompareTable({ cur, prior, currency }: { cur: PoTotals; prior: PoTotals; currency: string }) {
  const curRate = cur.orderedUnits > 0 ? cur.acceptedUnits / cur.orderedUnits : null;
  const priRate = prior.orderedUnits > 0 ? prior.acceptedUnits / prior.orderedUnits : null;
  return (
    <div className="panel" style={{ marginBottom: 20 }}>
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
          <CmpRow label="Ordered units" prior={prior.orderedUnits} cur={cur.orderedUnits} />
          <CmpRow label="Accepted units" prior={prior.acceptedUnits} cur={cur.acceptedUnits} higherIsBetter />
          <CmpRow label="Cancelled units" prior={prior.cancelledUnits} cur={cur.cancelledUnits} higherIsBetter={false} />
          <CmpRow label="Confirmation rate" prior={pctVal(priRate)} cur={pctVal(curRate)} suffix="%" higherIsBetter />
          <CmpRow label="Received units" prior={prior.receivedUnits} cur={cur.receivedUnits} higherIsBetter />
          <CmpRow label="Cancelled value" prior={prior.cancelledValue} cur={cur.cancelledValue} currency={currency} higherIsBetter={false} />
          <CmpRow label="Accepted value" prior={prior.acceptedValue} cur={cur.acceptedValue} currency={currency} higherIsBetter />
        </tbody>
      </table>
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

/** Horizontal stacked bar: accepted / cancelled / unconfirmed / downcounted. */
function StackBar({ totals }: { totals: PoTotals }) {
  const base = Math.max(1, totals.orderedUnits);
  const segs = [
    { label: "Accepted", units: totals.acceptedUnits, color: "var(--green)" },
    { label: "Cancelled", units: totals.cancelledUnits, color: "var(--red)" },
    { label: "Unconfirmed", units: totals.unconfirmedUnits, color: "var(--muted)" },
    { label: "Downcounted", units: totals.downcountedUnits, color: "var(--amber)" },
  ].filter((s) => s.units > 0);

  return (
    <div>
      <div className="stackbar">
        {segs.map((s) => (
          <div
            key={s.label}
            className="seg"
            style={{ width: `${(s.units / base) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.units.toLocaleString()}`}
          />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {segs.map((s) => (
          <span key={s.label}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} — {s.units.toLocaleString()} ({((s.units / base) * 100).toFixed(0)}%)
          </span>
        ))}
      </div>
    </div>
  );
}
