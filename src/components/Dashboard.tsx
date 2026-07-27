"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { compactMoney, number, percent } from "@/lib/format";
import { useSyncStatus, SyncButton, SyncBar, NetErrorBanner } from "@/components/sync-ui";
import type { SyncStatus } from "@/lib/types";

interface GridProduct {
  asin: string;
  style: string | null;
  style10: string | null;
  title: string | null;
  brand: string | null;
  thumbnail: string | null;
  productType: string | null;
  salesRank: number | null;
  hasAplus: boolean;
  shippedRevenue: number;
  shippedUnits: number;
  currency: string;
  listPrice: number | null;
  netCost: number | null;
  poUnits: number | null;
  returns: number;
  insightKind: "driver" | "drag" | "flat" | null;
  deltaPct: number | null;
}

interface ProductsResponse {
  meta: { generatedAt: string; productCount: number; salesWindow: { start: string; end: string } } | null;
  totals?: { sales: { shippedRevenue: number; shippedUnits: number; orderedRevenue: number; currency: string } };
  products: GridProduct[];
}

type SortKey = "revenue" | "units" | "delta" | "rank" | "price" | "markup" | "returns" | "title";

function markupPct(p: GridProduct): number | null {
  if (p.listPrice == null || p.netCost == null || p.listPrice <= 0) return null;
  return ((p.listPrice - p.netCost) / p.listPrice) * 100;
}

export default function Dashboard() {
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [filter, setFilter] = useState<"all" | "driver" | "drag" | "aplus" | "withcost" | "returns">("all");
  const [loading, setLoading] = useState(true);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ProductsResponse);
    } catch {
      /* surfaced via sync banner */
    } finally {
      setLoading(false);
    }
  }, []);

  const { status, netError, triggerSync } = useSyncStatus(loadProducts);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const products = data?.products ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = products.filter((p) => {
      if (filter === "driver" && p.insightKind !== "driver") return false;
      if (filter === "drag" && p.insightKind !== "drag") return false;
      if (filter === "aplus" && !p.hasAplus) return false;
      if (filter === "withcost" && p.listPrice == null) return false;
      if (filter === "returns" && p.returns <= 0) return false;
      if (!q) return true;
      return [p.asin, p.style, p.style10, p.title, p.brand]
        .filter(Boolean)
        .some((f) => f!.toLowerCase().includes(q));
    });
    return [...list].sort((a, b) => {
      switch (sort) {
        case "units":
          return b.shippedUnits - a.shippedUnits;
        case "delta":
          return (b.deltaPct ?? -Infinity) - (a.deltaPct ?? -Infinity);
        case "rank":
          return (a.salesRank ?? Infinity) - (b.salesRank ?? Infinity);
        case "price":
          return (b.listPrice ?? -Infinity) - (a.listPrice ?? -Infinity);
        case "markup":
          return (markupPct(b) ?? -Infinity) - (markupPct(a) ?? -Infinity);
        case "returns":
          return b.returns - a.returns;
        case "title":
          return (a.title ?? a.asin).localeCompare(b.title ?? b.asin);
        default:
          return b.shippedRevenue - a.shippedRevenue;
      }
    });
  }, [products, query, sort, filter]);

  const hasData = products.length > 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1>Catalog</h1>
          <p className="subtle">
            {data?.meta
              ? `${number(products.length)} ASINs · synced ${new Date(data.meta.generatedAt).toLocaleString()}`
              : "No data cached yet."}
          </p>
        </div>
        <SyncButton status={status} onSync={triggerSync} />
      </div>

      <NetErrorBanner message={netError} />
      <SyncBar status={status} />

      {hasData ? (
        <>
          <div className="controls">
            <input
              type="search"
              placeholder="Search ASIN, Style, Style10, title, brand…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="revenue">Sort: Shipped revenue</option>
              <option value="units">Sort: Shipped units</option>
              <option value="delta">Sort: Trend (Δ%)</option>
              <option value="price">Sort: List price</option>
              <option value="markup">Sort: Amazon markup %</option>
              <option value="returns">Sort: Returns</option>
              <option value="rank">Sort: Sales rank</option>
              <option value="title">Sort: Title A–Z</option>
            </select>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">All products</option>
              <option value="driver">Drivers only</option>
              <option value="drag">Drags only</option>
              <option value="withcost">Has price/cost</option>
              <option value="returns">Has returns</option>
              <option value="aplus">Has A+ content</option>
            </select>
            <span className="spacer" />
            <span className="subtle">{number(filtered.length)} shown</span>
          </div>

          <div className="grid">
            {filtered.slice(0, 600).map((p) => {
              const mk = markupPct(p);
              return (
                <Link key={p.asin} href={`/product/${p.asin}`} className="panel card">
                  <div className={`thumb${p.thumbnail ? "" : " empty"}`}>
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.thumbnail}
                        alt={p.title ?? p.asin}
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      "No image"
                    )}
                  </div>
                  <div className="body">
                    <div className="title">{p.title ?? p.asin}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {p.style10 && <span className="tag">{p.style10}</span>}
                      {p.hasAplus && <span className="tag aplus">A+</span>}
                      {mk != null && <span className="tag">{mk.toFixed(0)}% mkup</span>}
                      {p.insightKind === "driver" && <span className="tag driver">▲ {percent(p.deltaPct)}</span>}
                      {p.insightKind === "drag" && <span className="tag drag">▼ {percent(p.deltaPct)}</span>}
                    </div>
                    <div className="meta">
                      <span>{p.asin}</span>
                      <span>
                        {p.listPrice != null && (
                          <span className="muted" style={{ marginRight: 8 }}>
                            {compactMoney(p.listPrice, p.currency)}
                          </span>
                        )}
                        {compactMoney(p.shippedRevenue, p.currency)}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          {filtered.length > 600 && (
            <p className="subtle" style={{ marginTop: 16, textAlign: "center" }}>
              Showing first 600 of {number(filtered.length)} — refine your search or sort to narrow down.
            </p>
          )}
        </>
      ) : (
        !loading && <EmptyState status={status} onSync={triggerSync} />
      )}
    </>
  );
}

function EmptyState({ status, onSync }: { status: SyncStatus | null; onSync: () => void }) {
  const credError = status?.phase === "error" && /credential|environment/i.test(status.error ?? "");
  return (
    <div className="panel empty-state">
      {credError ? (
        <>
          <h2>Connect your SP-API credentials</h2>
          <p className="muted">
            Copy <code>.env.example</code> to <code>.env</code>, fill in your LWA <code>client id</code>,{" "}
            <code>secret</code> and <code>refresh token</code>, then restart and sync.
          </p>
          <p className="subtle">{status?.error}</p>
        </>
      ) : (
        <>
          <h2>No data yet</h2>
          <p className="muted">
            Run a sync to pull Vendor sales, forecast, purchase orders, and catalog content from the
            Selling Partner API.
          </p>
          <button className="btn" onClick={onSync} style={{ marginTop: 12 }}>
            Run first sync
          </button>
        </>
      )}
    </div>
  );
}
