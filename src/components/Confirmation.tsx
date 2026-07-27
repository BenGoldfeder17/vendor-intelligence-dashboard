"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LineChart } from "@/components/Charts";
import { rangeParam } from "@/components/RangePicker";
import CmpRow, { pctVal } from "@/components/CmpRow";
import { compactMoney, money, number, percent } from "@/lib/format";
import type { ConfirmationReport, ConfRow, PriorSummary, Segment } from "@/lib/confirmation";
import { identity } from "@/config/app.config";

type Brand = "all" | "OWN" | "OTHER";

interface Report extends ConfirmationReport {
  recoverableTotal: number;
  unavailableTotal: number;
  trend: Array<{
    date: string;
    allRate: number | null;
    ownRate: number | null;
    brandedRate: number | null;
  }>;
}

export default function Confirmation({ months, compare }: { months: number | null; compare: boolean }) {
  const [data, setData] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "needsReference" | "needsSync">("loading");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<Brand>("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/confirmation?months=${rangeParam(months)}`, { cache: "no-store" });
      const json = await res.json();
      if (json.needsReference) setState("needsReference");
      else if (json.needsSync) setState("needsSync");
      else {
        setData(json as Report);
        setState("ready");
      }
    } catch {
      setErr("Couldn't reach the server.");
    }
  }, [months]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setErr(null);
      try {
        const text = await file.text();
        const res = await fetch("/api/reference", {
          method: "POST",
          headers: { "Content-Type": "text/csv" },
          body: text,
        });
        const json = await res.json();
        if (!res.ok) {
          setErr(json.error || "Upload failed.");
        } else {
          await load();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  if (state === "loading") {
    return (
      <>
        <Head />
        <div className="panel panel-pad subtle">Loading…</div>
      </>
    );
  }

  if (state === "needsSync") {
    return (
      <>
        <Head />
        <div className="panel empty-state">
          <h2>No PO data yet</h2>
          <p className="muted">Run a sync first so there are PO lines to classify.</p>
          <Link className="btn" href="/risk?panel=confirmation">Go to PO & Confirmation</Link>
        </div>
      </>
    );
  }

  if (state === "needsReference") {
    return (
      <>
        <Head />
        <Uploader busy={busy} err={err} fileRef={fileRef} onUpload={upload} />
      </>
    );
  }

  const rep = data!;
  const cur = rep.currency;
  const recov = brandFilter === "all" ? rep.recoverable : rep.recoverable.filter((r) => r.brand === brandFilter);

  return (
    <>
      <Head meta={rep} />

      {rep.brandInferred && (
        <div className="warnbox">
          No <b>Brand</b> column was found in the upload, so {identity.ownBrandLabel}/{identity.otherBrandLabel} was inferred from product titles.
          Add a Brand column to the reference file for accurate segmentation.
        </div>
      )}

      <div className="ref-bar panel panel-pad">
        <span className="subtle">
          Reference: <b>{number(rep.meta.rowCount)}</b> ASINs · uploaded{" "}
          {new Date(rep.meta.uploadedAt).toLocaleString()} · {number(rep.counts.withCode)} with a cancel code ·{" "}
          {number(rep.counts.withOnHand)} with on-hand · {number(rep.counts.matchedToPo)} matched to PO data
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "Replace reference file"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>
      {err && <div className="warnbox" style={{ color: "var(--red)" }}>{err}</div>}

      <p className="subtle" style={{ marginTop: 16 }}>
        {rep.window.current.length
          ? `Window ${rep.window.current[0]} → ${rep.window.current[rep.window.current.length - 1]}`
          : "All available history"}
        {compare && rep.prior && rep.window.prior.length
          ? ` · compared to ${rep.window.prior[0]} → ${rep.window.prior[rep.window.prior.length - 1]}`
          : ""}
      </p>

      {/* Summary — comparison (previous vs current) when enabled, else current-only */}
      {compare && rep.prior ? (
        <>
          <h3 style={{ marginTop: 8 }}>Previous vs current</h3>
          <SegmentCompare title="All" seg={rep.segments.ALL} prior={rep.prior.ALL} cur={cur} />
          <div className="two-col" style={{ marginTop: 16 }}>
            <SegmentCompare title={identity.ownBrandLabel} seg={rep.segments.OWN} prior={rep.prior.OWN} cur={cur} />
            <SegmentCompare title="OTHER" seg={rep.segments.OTHER} prior={rep.prior.OTHER} cur={cur} />
          </div>
        </>
      ) : (
        <>
          <h3 style={{ marginTop: 8 }}>Submitted / Accepted / Rejected — {identity.ownBrandLabel} vs {identity.otherBrandLabel}</h3>
          <div className="two-col">
            <SummaryCard seg={rep.segments.OWN} title={identity.ownBrandLabel} cur={cur} />
            <SummaryCard seg={rep.segments.OTHER} title="OTHER" cur={cur} />
          </div>
        </>
      )}

      {/* Buckets */}
      <h3 style={{ marginTop: 24 }}>Classification — three buckets × two brands</h3>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th className="num">{identity.ownBrandLabel} ASINs</th>
              <th className="num">{identity.ownBrandLabel} Rejected $</th>
              <th className="num">{identity.otherBrandLabel} ASINs</th>
              <th className="num">{identity.otherBrandLabel} Rejected $</th>
            </tr>
          </thead>
          <tbody>
            <BucketRow label="🟢 Recoverable" hint="non-N code + on-hand > 0" b="recoverable" rep={rep} cur={cur} />
            <BucketRow label="🔴 Mark Unavailable" hint="non-N code + on-hand = 0" b="unavailable" rep={rep} cur={cur} />
            <BucketRow label="⚪ True Stockout" hint="N code + on-hand = 0" b="stockout" rep={rep} cur={cur} />
          </tbody>
        </table>
      </div>

      {/* Recoverable opportunity */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>🟢 Recoverable opportunity</h3>
        <span className="spacer" />
        <div className="segmented">
          {(["all", "OWN", "OTHER"] as Brand[]).map((b) => (
            <button key={b} className={b === brandFilter ? "active" : ""} onClick={() => setBrandFilter(b)}>
              {b === "all" ? "All" : b}
            </button>
          ))}
        </div>
        <a className="btn" href={`/api/confirmation/export?bucket=recoverable&brand=${brandFilter}&months=${rangeParam(months)}`}>
          ⤓ Export CSV
        </a>
      </div>
      <p className="subtle" style={{ margin: "4px 0 10px" }}>
        Cancelled despite stock on hand — review the code (internal fix likely on {identity.ownBrandLabel}). Showing top{" "}
        {number(recov.length)} of {number(rep.recoverableTotal)}.
      </p>
      <RowTable rows={recov.slice(0, 200)} cur={cur} />

      {/* Unavailable candidates */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>🔴 Mark Unavailable candidates</h3>
        <span className="spacer" />
        <a className="btn" href={`/api/confirmation/export?bucket=unavailable&brand=OWN&months=${rangeParam(months)}`}>⤓ {identity.ownBrandLabel}</a>
        <a className="btn" href={`/api/confirmation/export?bucket=unavailable&brand=OTHER&months=${rangeParam(months)}`}>⤓ {identity.otherBrandLabel}</a>
        <a className="btn btn-ghost" href={`/api/confirmation/export?bucket=unavailable&brand=all&months=${rangeParam(months)}`}>⤓ All</a>
      </div>
      <p className="subtle" style={{ margin: "4px 0 10px" }}>
        Persistent cancel code + zero on-hand — suppress in Amazon to stop the PO/cancel cycle.{" "}
        {number(rep.unavailableTotal)} candidate ASIN(s).
      </p>
      <RowTable rows={rep.unavailable.slice(0, 200)} cur={cur} />

      {/* Code breakdown */}
      <h3 style={{ marginTop: 24 }}>Rejection drivers by code</h3>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th className="num">{identity.ownBrandLabel} ASINs</th>
              <th className="num">{identity.ownBrandLabel} Rejected $</th>
              <th className="num">{identity.otherBrandLabel} ASINs</th>
              <th className="num">{identity.otherBrandLabel} Rejected $</th>
              <th className="num">Total $</th>
            </tr>
          </thead>
          <tbody>
            {rep.codeBreakdown.map((c) => (
              <tr key={c.code}>
                <td>
                  <b>{c.code}</b> <span className="muted">{c.label}</span>
                </td>
                <td className="num">{number(c.ownAsins)}</td>
                <td className="num">{money(c.ownRejected, cur)}</td>
                <td className="num">{number(c.brandedAsins)}</td>
                <td className="num">{money(c.brandedRejected, cur)}</td>
                <td className="num">{money(c.totalRejected, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirmation rate trend */}
      <h3 style={{ marginTop: 24 }}>Confirmation Rate trend (accrues each sync)</h3>
      <div className="panel panel-pad">
        {rep.trend.length > 1 ? (
          <>
            <div className="legend">
              <span><span className="swatch" style={{ background: "var(--accent)" }} />All</span>
              <span><span className="swatch" style={{ background: "var(--green)" }} />{identity.ownBrandLabel}</span>
              <span><span className="swatch" style={{ background: "var(--accent-2)" }} />{identity.otherBrandLabel}</span>
            </div>
            <LineChart
              labels={rep.trend.map((t) => t.date)}
              series={[
                { name: "All", color: "var(--accent)", values: rep.trend.map((t) => pct(t.allRate)) },
                { name: identity.ownBrandLabel, color: "var(--green)", values: rep.trend.map((t) => pct(t.ownRate)) },
                { name: "OTHER", color: "var(--accent-2)", values: rep.trend.map((t) => pct(t.brandedRate)) },
              ]}
              yLabel="Confirmation rate %"
            />
          </>
        ) : (
          <p className="subtle">
            One snapshot so far ({rep.trend[0]?.date}). The trend builds a point per day as you re-sync and take
            Unavailable actions — come back to watch each brand segment improve.
          </p>
        )}
      </div>
    </>
  );
}

function pct(v: number | null): number | null {
  return v == null ? null : Math.round(v * 1000) / 10;
}

function Head({ meta }: { meta?: Report }) {
  return (
    <div>
      <h1>Confirmation Rate</h1>
      <p className="subtle">
        Code-aware PO acceptance — recover revenue we should be confirming, and suppress what we&apos;ll never ship.
        {meta ? ` Generated ${new Date(meta.generatedAt).toLocaleString()}.` : ""}
      </p>
    </div>
  );
}

function Uploader({
  busy,
  err,
  fileRef,
  onUpload,
}: {
  busy: boolean;
  err: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (f: File) => void;
}) {
  return (
    <div className="panel empty-state">
      <h2>Upload the reference file</h2>
      <p className="muted" style={{ maxWidth: 620, margin: "0 auto 8px" }}>
        Drop Ben&apos;s export with columns <code>ASIN, Style, Brand, Code, eComm On Hand</code> (header names are
        matched flexibly). Brand is optional but recommended — without it, own vs other brand is inferred from titles.
      </p>
      <p className="subtle" style={{ marginBottom: 16 }}>
        Codes: N=in stock · M Margin · V Vendor Prohibits · F MOI/Factor · H Hazmat · I Inventory · Q Quality · W
        Warehouse · Y Catch-All · S Seasonality · P NetPPM · D Discontinued
      </p>
      <button className="btn btn-cta" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? "Uploading…" : "Choose CSV file"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
      />
      {err && <p style={{ color: "var(--red)", marginTop: 14 }}>{err}</p>}
    </div>
  );
}

function SummaryCard({ seg, title, cur }: { seg: Segment; title: string; cur: string }) {
  const crStr = seg.confirmationRate != null ? `${(seg.confirmationRate * 100).toFixed(1)}%` : "—";
  return (
    <div className="panel panel-pad">
      <h2>{title}</h2>
      <div className="kpis" style={{ marginBottom: 0 }}>
        <Kpi label="Submitted $" value={compactMoney(seg.submitted, cur)} />
        <Kpi label="Accepted $" value={compactMoney(seg.accepted, cur)} />
        <Kpi label="Rejected $" value={compactMoney(seg.rejected, cur)} />
        <Kpi label="Confirmation Rate" value={crStr} />
      </div>
    </div>
  );
}

/** Expanded "previous vs current" table for one brand segment. */
function SegmentCompare({ title, seg, prior, cur }: { title: string; seg: Segment; prior: PriorSummary; cur: string }) {
  return (
    <div className="panel">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
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
          <CmpRow label="Submitted $" prior={prior.submitted} cur={seg.submitted} currency={cur} />
          <CmpRow label="Accepted $" prior={prior.accepted} cur={seg.accepted} currency={cur} higherIsBetter />
          <CmpRow label="Rejected $" prior={prior.rejected} cur={seg.rejected} currency={cur} higherIsBetter={false} />
          <CmpRow label="Confirmation rate" prior={pctVal(prior.confirmationRate)} cur={pctVal(seg.confirmationRate)} suffix="%" higherIsBetter />
          <CmpRow label="Recoverable $" prior={prior.recoverableValue} cur={seg.buckets.recoverable.rejectedValue} currency={cur} higherIsBetter={false} />
        </tbody>
      </table>
    </div>
  );
}

function BucketRow({
  label,
  hint,
  b,
  rep,
  cur,
}: {
  label: string;
  hint: string;
  b: "recoverable" | "unavailable" | "stockout";
  rep: Report;
  cur: string;
}) {
  const m = rep.segments.OWN.buckets[b];
  const br = rep.segments.OTHER.buckets[b];
  return (
    <tr>
      <td>
        {label}
        <div className="subtle">{hint}</div>
      </td>
      <td className="num">{number(m.asins)}</td>
      <td className="num">{money(m.rejectedValue, cur)}</td>
      <td className="num">{number(br.asins)}</td>
      <td className="num">{money(br.rejectedValue, cur)}</td>
    </tr>
  );
}

function RowTable({ rows, cur }: { rows: ConfRow[]; cur: string }) {
  if (!rows.length) return <div className="panel panel-pad subtle">None.</div>;
  return (
    <div className="panel">
      <table>
        <thead>
          <tr>
            <th>Style / Product</th>
            <th>Brand</th>
            <th>Code</th>
            <th className="num">On Hand</th>
            <th className="num">Cancelled</th>
            <th className="num">Rejected $</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.asin}>
              <td>
                <Link href={`/product/${r.asin}`}>{r.style || r.title || r.asin}</Link>
                <div className="subtle">{r.title ? `${r.asin}` : r.asin}</div>
              </td>
              <td>
                <span className={`tag ${r.brand === "OWN" ? "aplus" : ""}`}>{r.brand === "OWN" ? identity.ownBrandLabel : identity.otherBrandLabel}</span>
              </td>
              <td>
                <b>{r.code ?? "—"}</b> <span className="muted">{r.codeLabel}</span>
              </td>
              <td className="num">{number(r.onHand)}</td>
              <td className="num neg">{number(r.cancelledUnits)}</td>
              <td className="num">{money(r.rejectedValue, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 18 }}>
        {value}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
