"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CrapReport, CrapRow, Verdict } from "@/lib/crap";
import { money, number, percent } from "@/lib/format";

const VERDICT: Record<Verdict, { label: string; blurb: string; tone: string }> = {
  silent_crap: {
    label: "Silent CRaP",
    blurb: "Margin below benchmark, Amazon ordering less, and we never suppressed it.",
    tone: "bad",
  },
  self_suppressed: {
    label: "We suppressed it",
    blurb: "Amazon ordered less because our code told it to. Lane 3 working as intended.",
    tone: "neutral",
  },
  margin_watch: {
    label: "Margin watch",
    blurb: "Below benchmark, but POs are holding. The screen hasn't bitten yet.",
    tone: "warn",
  },
  healthy: { label: "Healthy", blurb: "Margin at or above benchmark.", tone: "ok" },
  thin_data: { label: "Too thin to judge", blurb: "No shipments and no POs.", tone: "muted" },
};

export default function MarginWatch() {
  const [weeks, setWeeks] = useState(8);
  const [benchmark, setBenchmark] = useState(0.35);
  const [data, setData] = useState<(CrapReport & { rowTotal?: number; needsSync?: boolean }) | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Verdict | "all">("silent_crap");

  useEffect(() => {
    setLoading(true);
    void (async () => {
      const r = await fetch(`/api/margin?weeks=${weeks}&benchmark=${benchmark}`, {
        cache: "no-store",
      });
      setData(await r.json());
      setLoading(false);
    })();
  }, [weeks, benchmark]);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    return filter === "all" ? data.rows : data.rows.filter((r) => r.verdict === filter);
  }, [data, filter]);

  if (loading && !data) return <div className="panel panel-pad subtle">Loading margin data…</div>;

  if (data?.needsSync) {
    return (
      <div className="panel empty-state">
        <h2>No data yet</h2>
        <p className="muted">Run a sync from the Overview page first.</p>
      </div>
    );
  }
  if (!data) return null;

  const cur = data.currency;

  return (
    <>
      <h1 style={{ marginBottom: 4 }}>Margin Watch</h1>
      <p className="subtle" style={{ marginBottom: 20 }}>
        The lane classifier only sees POs that arrive. Amazon&apos;s PO engine is margin-filtered —
        when an ASIN&apos;s margin drops, Amazon quietly buys less of it, or stops. That produces no
        PO line to classify. This finds that silence.
      </p>

      {data.notes.length > 0 && (
        <div className="mw-notes">
          {data.notes.map((n) => (
            <div key={n} className="mw-note">
              {n}
            </div>
          ))}
        </div>
      )}

      {/* controls */}
      <div className="controls" style={{ marginBottom: 16 }}>
        <label className="mw-ctl">
          Window
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={4}>4 weeks vs prior 4</option>
            <option value={8}>8 weeks vs prior 8</option>
            <option value={13}>13 weeks vs prior 13</option>
            <option value={26}>26 weeks vs prior 26</option>
          </select>
        </label>
        <label className="mw-ctl">
          Benchmark PPM
          <select value={benchmark} onChange={(e) => setBenchmark(Number(e.target.value))}>
            <option value={0.25}>25%</option>
            <option value={0.3}>30%</option>
            <option value={0.35}>35% — softlines</option>
            <option value={0.4}>40% — hardlines</option>
          </select>
        </label>
        <span className="subtle small">
          {data.window.recent.length} recent week(s) vs {data.window.prior.length} prior
        </span>
      </div>

      {/* headline */}
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">Silent CRaP ASINs</div>
          <div className="value" style={{ color: "var(--red)" }}>
            {number(data.counts.silent_crap)}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Revenue in that bucket</div>
          <div className="value">{money(data.atRisk.shippedRevenue, cur)}</div>
        </div>
        <div className="kpi">
          <div className="label">PO units lost</div>
          <div className="value">{number(data.atRisk.poUnitsLost)}</div>
        </div>
        <div className="kpi">
          <div className="label">Portfolio PPM (gross)</div>
          <div className="value">
            {data.portfolio.ppm != null ? percent(data.portfolio.ppm) : "—"}
          </div>
        </div>
      </div>

      {/* verdict tabs */}
      <div className="mw-tabs">
        {(Object.keys(VERDICT) as Verdict[]).map((v) => (
          <button
            key={v}
            className={`mw-tab ${VERDICT[v].tone} ${filter === v ? "on" : ""}`}
            onClick={() => setFilter(v)}
          >
            {VERDICT[v].label}
            <b>{data.counts[v]}</b>
          </button>
        ))}
        <button className={`mw-tab ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          All
          <b>{data.rowTotal ?? data.rows.length}</b>
        </button>
      </div>

      {filter !== "all" && <p className="subtle small mw-blurb">{VERDICT[filter].blurb}</p>}

      {rows.length === 0 ? (
        <div className="panel panel-pad subtle">Nothing in this bucket.</div>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">ASP</th>
                <th className="num">Amazon cost</th>
                <th className="num">PPM</th>
                <th className="num">Δ PPM</th>
                <th className="num">PO units</th>
                <th className="num">PO change</th>
                <th>Code</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <Row key={r.asin} r={r} cur={cur} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="subtle small" style={{ marginTop: 12 }}>
        PPM here is <strong>gross</strong>: (shipped revenue − shipped COGS) ÷ shipped revenue, from
        the vendor sales report in <strong>Sourcing</strong> view. It is not Amazon&apos;s Net PPM,
        which also folds in vendor terms and subtracts sales discounts — and whose contra-COGS is
        Amazon&apos;s own estimate rather than your actual co-op deductions. Same direction,
        different number.
      </p>
    </>
  );
}

function Row({ r, cur }: { r: CrapRow; cur: string }) {
  return (
    <tr>
      <td>
        <Link href={`/product/${r.asin}`}>{r.title ?? r.asin}</Link>
        <div className="subtle small">
          {r.style ? `${r.style} · ` : ""}
          {r.asin}
          {r.undercut && (
            <span className="mw-flag" title="Our own advertised price is below Amazon's ASP.">
              undercutting ourselves
            </span>
          )}
        </div>
      </td>
      <td className="num">{r.asp != null ? money(r.asp, cur) : "—"}</td>
      <td className="num">{r.unitCost != null ? money(r.unitCost, cur) : "—"}</td>
      <td className={`num ${r.belowBenchmark ? "neg" : ""}`}>
        {r.ppm != null ? percent(r.ppm) : "—"}
      </td>
      <td className={`num ${(r.ppmDelta ?? 0) < 0 ? "neg" : "pos"}`}>
        {r.ppmDelta != null ? percent(r.ppmDelta) : "—"}
      </td>
      <td className="num">
        {number(r.poRecent)}
        <span className="subtle small"> / {number(r.poPrior)}</span>
      </td>
      <td className={`num ${(r.poDecay ?? 0) < 0 ? "neg" : "pos"}`}>
        {r.poDecay != null ? percent(r.poDecay) : "—"}
      </td>
      <td>
        {r.code ? (
          <span className={r.suppressed ? "mw-code sup" : "mw-code"}>{r.code}</span>
        ) : (
          <span className="subtle">—</span>
        )}
      </td>
    </tr>
  );
}
