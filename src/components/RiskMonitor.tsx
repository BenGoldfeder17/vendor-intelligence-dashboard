"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { money, number, percent } from "@/lib/format";
import { identity, warehouse } from "@/config/app.config";

interface RiskData {
  bigQueryEnabled: boolean;
  hasAra: boolean;
  hasAggregate: boolean;
  summary?: {
    posture: "healthy" | "watch" | "at_risk";
    blendedNetPpm: number | null;
    floorHeadroomPts: number | null;
    floorStatus: "green" | "amber" | "red" | null;
    belowFloorCount: number;
    belowFloorRevenue: number;
    codesAtRisk: number;
    totalCodes: number;
    marginSuppressionRevenue: number | null;
    fillGapPct: number | null;
    brokenTailAsins: number;
    worstCode: {
      code: string | null;
      netPpm: number | null;
      headroomPts: number | null;
      revenue: number;
    } | null;
  };
  margin: {
    floor: {
      blendedNetPpm: number | null;
      floor: number;
      headroomPts: number | null;
      status: "green" | "amber" | "red";
      revenue: number;
      asinsScored: number;
    };
    brandCodes: {
      brandCode: string;
      netPpm: number | null;
      floor: number;
      headroomPts: number | null;
      revenue: number;
      asins: number;
      status: "green" | "amber" | "red";
    }[];
    reprice: {
      count: number;
      revenue: number;
      trend: "up" | "down" | "flat" | null;
      improvedCount: number;
      worsenedCount: number;
    };
    quality: { brokenTailAsins: number; brokenTailRevenue: number; note: string };
  } | null;
  suppression: {
    available: boolean;
    reason?: string;
    marginStyles: number;
    marginRevenue: number;
    operationalStyles: number;
    operationalRevenue: number;
    unknownStyles: number;
    unknownRevenue: number;
    unknownLetters: string[];
    rows: { style: string; letters: string[]; class: string; revenue: number }[];
  };
  fill: {
    available: boolean;
    reason?: string;
    styles: {
      style: string;
      onHand: number;
      onOrder: number;
      inRoute: number;
      coverRatio: number | null;
    }[];
    orderedVsShippedGapPct: number | null;
  };
  araMeta: { uploadedAt: string; rowCount: number } | null;
}

export default function RiskMonitor() {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/risk", { cache: "no-store" });
    setData(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadAra(file: File) {
    setUploading(true);
    setMsg(null);
    const text = await file.text();
    const r = await fetch("/api/ara-net-ppm", { method: "POST", body: text });
    const j = (await r.json()) as { ok?: boolean; error?: string; warnings?: string[] };
    setUploading(false);
    if (j.error) {
      setMsg(j.error);
      return;
    }
    setMsg(j.warnings?.length ? j.warnings.join(" ") : "ARA Net PPM loaded.");
    void load();
  }

  if (loading && !data) return <div className="panel panel-pad subtle">Loading risk monitor…</div>;
  if (!data) return null;

  const m = data.margin;

  return (
    <div className="rm">
      <div className="rm-head">
        <div>
          <h1>1P Revenue Risk Monitor</h1>
          <p className="subtle">
            Net PPM tells you whether Amazon makes money on an item — not whether it&apos;s still
            selling it. This is read-only: it surfaces risk, it changes nothing.
          </p>
        </div>
        <div className="rm-head-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAra(f);
              e.target.value = "";
            }}
          />
          <span className="subtle small" style={{ alignSelf: "center" }}>
            Net PPM refreshes automatically with <strong>Sync</strong> (top right).
          </span>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {data.hasAra ? "Replace with CSV" : "Upload CSV instead"}
          </button>
        </div>
      </div>

      {msg && <div className="rm-msg">{msg}</div>}

      {/* ── Synthesized risk posture — the whole picture, before the tables ── */}
      {data.summary && (m || data.summary.marginSuppressionRevenue != null) && (
        <RiskSummaryBand s={data.summary} />
      )}

      {!data.bigQueryEnabled && (
        <div className="rm-block">
          <strong>BigQuery isn&apos;t connected</strong>
          <p>
            Panels 4 and 5 (suppression ledger, fill risk) read your{" "}
            <code>{warehouse.sourceDataset}</code> dataset. Set{" "}
            <code>WAREHOUSE_ENABLED</code> and <code>BQ_PROJECT</code>, and grant the runtime
            identity read access. The margin panels below work without it.
          </p>
        </div>
      )}

      {/* ── Panels 1-3, 6: margin side (CSV) ── */}
      {!m ? (
        <div className="rm-block">
          <strong>Upload the ARA Net PPM export to see the margin panels</strong>
          <p>Panels 1, 2, 3 and 6 all read that one CSV. Drop it in with the button above.</p>
        </div>
      ) : (
        <>
          {/* Panel 6 rides at the top intentionally — its job is to stop you reacting to a bad average. */}
          {m.quality.brokenTailAsins > 0 && (
            <div className="rm-strip">
              <span className="rm-strip-tag">Data quality</span>
              {m.quality.note}
            </div>
          )}

          <div className="rm-row">
            {/* Panel 1 — Floor gauge */}
            <section id="floor" className={`rm-gauge ${m.floor.status}`}>
              <div className="rm-panel-label">Blended Net PPM vs floor</div>
              <div className="rm-gauge-value">
                {m.floor.blendedNetPpm != null ? percent(m.floor.blendedNetPpm) : "—"}
              </div>
              <div className="rm-gauge-floor">
                blended floor {percent(m.floor.floor)} ·{" "}
                <span className={m.floor.status}>
                  {m.floor.headroomPts != null
                    ? `${m.floor.headroomPts >= 0 ? "+" : ""}${m.floor.headroomPts.toFixed(2)} pts`
                    : "—"}
                </span>
              </div>
              <div className="rm-gauge-sub subtle">
                revenue-weighted over {number(m.floor.asinsScored)} ASINs ·{" "}
                {money(m.floor.revenue, "USD")}
              </div>
            </section>

            {/* Panel 3 — Reprice targets */}
            <section id="reprice" className="rm-stat">
              <div className="rm-panel-label">Reprice targets — ASINs below floor</div>
              <div className="rm-stat-value">
                {number(m.reprice.count)}
                {m.reprice.trend && (
                  <span className={`rm-trend ${m.reprice.trend}`}>
                    {m.reprice.trend === "up" ? "↑" : m.reprice.trend === "down" ? "↓" : "→"}
                  </span>
                )}
              </div>
              <div className="rm-stat-sub subtle">{money(m.reprice.revenue, "USD")} of revenue</div>
              {(m.reprice.improvedCount > 0 || m.reprice.worsenedCount > 0) && (
                <div className="rm-stat-sub subtle">
                  vs prior: {m.reprice.improvedCount} improved, {m.reprice.worsenedCount} worse
                </div>
              )}
            </section>
          </div>

          {/* Panel 2 — Brand code concentration */}
          <section id="brandcode" className="panel">
            <div className="card-head">
              <strong>Net PPM by vendor / brand code</strong>
              <span className="subtle small">each code vs its own contracted floor — weakest first</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Brand code</th>
                  <th className="num">Net PPM</th>
                  <th className="num">Its floor</th>
                  <th className="num">Headroom</th>
                  <th className="num">Revenue</th>
                  <th className="num">ASINs</th>
                </tr>
              </thead>
              <tbody>
                {m.brandCodes.map((b) => (
                  <tr key={b.brandCode}>
                    <td>
                      <span className={`rm-dot ${b.status}`} /> {b.brandCode}
                    </td>
                    <td className="num">{b.netPpm != null ? percent(b.netPpm) : "—"}</td>
                    <td className="num subtle">{percent(b.floor)}</td>
                    <td className={`num ${b.status === "red" ? "neg" : ""}`}>
                      {b.headroomPts != null
                        ? `${b.headroomPts >= 0 ? "+" : ""}${b.headroomPts.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="num">{money(b.revenue, "USD")}</td>
                    <td className="num">{number(b.asins)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* ── Panel 4: suppression ledger (BQ) ── */}
      <section id="suppression" className="panel">
        <div className="card-head">
          <strong>Suppression ledger — what {identity.orgName} is unlisting</strong>
          <span className="subtle small">the cost of your own SendZeroFlags policy</span>
        </div>
        {!data.suppression.available ? (
          <div className="panel-pad rm-unavail">
            {data.suppression.reason ?? "Unavailable."}
          </div>
        ) : (
          <>
            <div className="rm-ledger">
              <div className="rm-ledger-cell margin">
                <div className="rm-panel-label">Margin-driven (M)</div>
                <div className="rm-ledger-value">{money(data.suppression.marginRevenue, "USD")}</div>
                <div className="subtle small">
                  {number(data.suppression.marginStyles)} styles — revenue you suppress for margin
                </div>
              </div>
              <div className="rm-ledger-cell op">
                <div className="rm-panel-label">Operational (Q/I/F/Y)</div>
                <div className="rm-ledger-value">
                  {money(data.suppression.operationalRevenue, "USD")}
                </div>
                <div className="subtle small">{number(data.suppression.operationalStyles)} styles</div>
              </div>
              <div className="rm-ledger-cell unknown">
                <div className="rm-panel-label">
                  Unknown{" "}
                  {data.suppression.unknownLetters.length > 0 &&
                    `(${data.suppression.unknownLetters.join("/")})`}
                </div>
                <div className="rm-ledger-value">{money(data.suppression.unknownRevenue, "USD")}</div>
                <div className="subtle small">
                  {number(data.suppression.unknownStyles)} styles — codes undefined, not interpreted
                </div>
              </div>
            </div>
            {data.suppression.unknownLetters.length > 0 && (
              <div className="rm-unknown-note">
                Flags {data.suppression.unknownLetters.join(", ")} have no agreed meaning yet, so
                their revenue is shown but not classified. Define them to move this out of “unknown.”
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Panel 5: fill risk (BQ) ── */}
      <section id="fill" className="panel">
        <div className="card-head">
          <strong>Fill risk — can you supply what Amazon orders?</strong>
          {data.fill.orderedVsShippedGapPct != null && (
            <span
              className={`rm-gap ${Math.abs(data.fill.orderedVsShippedGapPct) < 2 ? "ok" : "warn"}`}
            >
              ordered-vs-shipped gap {data.fill.orderedVsShippedGapPct.toFixed(1)}%
            </span>
          )}
        </div>
        {!data.fill.available ? (
          <div className="panel-pad rm-unavail">{data.fill.reason ?? "Unavailable."}</div>
        ) : data.fill.styles.length === 0 ? (
          <div className="panel-pad subtle">No inventory rows.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Style</th>
                <th className="num">On hand</th>
                <th className="num">On order</th>
                <th className="num">In route</th>
                <th className="num">Cover</th>
              </tr>
            </thead>
            <tbody>
              {data.fill.styles.slice(0, 50).map((s) => (
                <tr key={s.style}>
                  <td>{s.style}</td>
                  <td className="num">{number(s.onHand)}</td>
                  <td className="num">{number(s.onOrder)}</td>
                  <td className="num">{number(s.inRoute)}</td>
                  <td className={`num ${s.coverRatio != null && s.coverRatio < 1 ? "neg" : ""}`}>
                    {s.coverRatio != null ? `${(s.coverRatio * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="subtle small rm-foot">
        Blocked by design until their data is located: the DTC-leak panel (needs{" "}
        {identity.dtcSiteName} price + pack size), the Buy Box panel (needs marketplace
        competitive-pricing data or a third-party tool), and margin-leak reconciliation (needs
        chargeback/deduction data). This monitor is honest about what it can&apos;t yet see.
      </p>
    </div>
  );
}

const POSTURE: Record<
  "healthy" | "watch" | "at_risk",
  { label: string; cls: string; icon: string; blurb: string }
> = {
  healthy: {
    label: "Healthy",
    cls: "ok",
    icon: "ti-circle-check",
    blurb: "Blended margin clears the floor and no vendor code is underwater.",
  },
  watch: {
    label: "Watch",
    cls: "warn",
    icon: "ti-alert-triangle",
    blurb: "Margin is holding overall, but some revenue sits below the floor.",
  },
  at_risk: {
    label: "At risk",
    cls: "bad",
    icon: "ti-alert-octagon",
    blurb: "The blend or a vendor code is below the floor — reprice pressure is live.",
  },
};

function RiskSummaryBand({
  s,
}: {
  s: NonNullable<RiskData["summary"]>;
}) {
  const p = POSTURE[s.posture];
  return (
    <div className={`rm-summary ${p.cls}`}>
      <div className="rm-summary-hero">
        <div className={`rm-summary-badge ${p.cls}`}>
          <i className={`ti ${p.icon}`} aria-hidden="true" />
        </div>
        <div>
          <div className="rm-summary-label">{p.label}</div>
          <div className="rm-summary-blurb">{p.blurb}</div>
        </div>
      </div>

      <div className="rm-summary-metrics">
        <a href="#floor" className="rm-summary-metric">
          <div className="rm-summary-metric-label">Blended Net PPM</div>
          <div className={`rm-summary-metric-value ${s.floorStatus ?? ""}`}>
            {s.blendedNetPpm != null ? percent(s.blendedNetPpm) : "—"}
          </div>
          <div className="rm-summary-metric-sub">
            {s.floorHeadroomPts != null
              ? `${s.floorHeadroomPts >= 0 ? "+" : ""}${s.floorHeadroomPts.toFixed(1)} pts vs floor`
              : "no floor data"}
          </div>
        </a>

        <a href="#reprice" className="rm-summary-metric">
          <div className="rm-summary-metric-label">Below floor</div>
          <div className="rm-summary-metric-value">{number(s.belowFloorCount)}</div>
          <div className="rm-summary-metric-sub">{money(s.belowFloorRevenue, "USD")} of revenue</div>
        </a>

        <a href="#brandcode" className="rm-summary-metric">
          <div className="rm-summary-metric-label">Vendor codes at risk</div>
          <div className={`rm-summary-metric-value ${s.codesAtRisk > 0 ? "red" : ""}`}>
            {s.codesAtRisk}
            <span className="rm-summary-of">/ {s.totalCodes}</span>
          </div>
          <div className="rm-summary-metric-sub">
            {s.worstCode?.code
              ? `worst: ${s.worstCode.code} ${
                  s.worstCode.netPpm != null ? percent(s.worstCode.netPpm) : ""
                }`
              : "—"}
          </div>
        </a>

        {s.marginSuppressionRevenue != null && (
          <a href="#suppression" className="rm-summary-metric">
            <div className="rm-summary-metric-label">Suppressed for margin</div>
            <div className="rm-summary-metric-value">{money(s.marginSuppressionRevenue, "USD")}</div>
            <div className="rm-summary-metric-sub">the cost of your unlisting policy</div>
          </a>
        )}

        {s.fillGapPct != null && (
          <a href="#fill" className="rm-summary-metric">
            <div className="rm-summary-metric-label">Fill gap</div>
            <div className={`rm-summary-metric-value ${Math.abs(s.fillGapPct) >= 2 ? "amber" : ""}`}>
              {s.fillGapPct.toFixed(1)}%
            </div>
            <div className="rm-summary-metric-sub">ordered vs shipped</div>
          </a>
        )}
      </div>
    </div>
  );
}
