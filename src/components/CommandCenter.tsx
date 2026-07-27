"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TriageFeed, Signal, Severity } from "@/lib/triage";
import { money, number } from "@/lib/format";

const SEV: Record<Severity, { label: string; cls: string }> = {
  action: { label: "Action", cls: "sev-action" },
  watch: { label: "Watch", cls: "sev-watch" },
  info: { label: "Info", cls: "sev-info" },
};

const DOMAIN_LABEL: Record<string, string> = {
  risk: "Revenue risk",
  sales: "Sales",
  listings: "Listings",
};

export default function CommandCenter() {
  const [feed, setFeed] = useState<TriageFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Severity | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/triage", { cache: "no-store" });
    setFeed(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !feed) return <div className="panel panel-pad subtle">Reading signals…</div>;
  if (!feed) return null;

  const cur = feed.headline.currency;
  const signals =
    filter === "all" ? feed.signals : feed.signals.filter((s) => s.severity === filter);
  const nothing = feed.signals.length === 0;

  return (
    <div className="cc">
      <div className="cc-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>Command center</h1>
          <p className="subtle" style={{ margin: 0 }}>
            What needs attention now, ranked across revenue risk, sales, and listings.
          </p>
        </div>
        <div className="cc-synced subtle">
          {feed.synced ? (
            <>
              <i className="ti ti-refresh" aria-hidden="true" /> synced{" "}
              {new Date(feed.synced).toLocaleString()}
            </>
          ) : (
            "not synced yet"
          )}
        </div>
      </div>

      {/* headline metrics */}
      <div className="cc-kpis">
        <button
          className={`cc-kpi action ${filter === "action" ? "on" : ""}`}
          onClick={() => setFilter(filter === "action" ? "all" : "action")}
        >
          <div className="cc-kpi-label">Needs action</div>
          <div className="cc-kpi-value">{feed.counts.action}</div>
        </button>
        <button
          className={`cc-kpi watch ${filter === "watch" ? "on" : ""}`}
          onClick={() => setFilter(filter === "watch" ? "all" : "watch")}
        >
          <div className="cc-kpi-label">Watch</div>
          <div className="cc-kpi-value">{feed.counts.watch}</div>
        </button>
        <div className="cc-kpi">
          <div className="cc-kpi-label">Revenue at risk</div>
          <div className="cc-kpi-value">{money(feed.headline.revenueAtRisk, cur)}</div>
        </div>
        <div className="cc-kpi">
          <div className="cc-kpi-label">Margin floor</div>
          <div className="cc-kpi-value">
            {feed.headline.floorHeadroomPts != null ? (
              <span className={feed.headline.floorHeadroomPts >= 0 ? "pos" : "neg"}>
                {feed.headline.floorHeadroomPts >= 0 ? "+" : ""}
                {feed.headline.floorHeadroomPts.toFixed(1)}
                <span className="cc-unit">pts</span>
              </span>
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>

      {filter !== "all" && (
        <button className="cc-clear" onClick={() => setFilter("all")}>
          ← show all signals
        </button>
      )}

      {/* signal feed */}
      {nothing ? (
        <div className="cc-clear-state">
          <i className="ti ti-circle-check" aria-hidden="true" />
          <div>
            <strong>Nothing needs attention right now.</strong>
            <p className="subtle">
              As sales history builds and data sources connect, signals will appear here worst-first.
            </p>
          </div>
        </div>
      ) : (
        <div className="cc-feed">
          {signals.map((s) => (
            <SignalRow key={s.id} s={s} />
          ))}
        </div>
      )}

      {/* blind spots */}
      {feed.blindSpots.length > 0 && (
        <div className="cc-blind">
          <div className="cc-blind-head">
            <i className="ti ti-eye-off" aria-hidden="true" /> What this can&apos;t see yet
          </div>
          <ul>
            {feed.blindSpots.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SignalRow({ s }: { s: Signal }) {
  const sev = SEV[s.severity];
  return (
    <Link href={s.href} className={`cc-signal ${sev.cls}`}>
      <div className="cc-signal-icon">
        <i className={`ti ${s.icon}`} aria-hidden="true" />
      </div>
      <div className="cc-signal-body">
        <div className="cc-signal-title-row">
          <span className="cc-signal-title">{s.title}</span>
          <span className={`cc-badge ${sev.cls}`}>{sev.label}</span>
        </div>
        <div className="cc-signal-detail">{s.detail}</div>
        <div className="cc-signal-to">
          <i className="ti ti-arrow-right" aria-hidden="true" /> {DOMAIN_LABEL[s.domain]}
        </div>
      </div>
    </Link>
  );
}
