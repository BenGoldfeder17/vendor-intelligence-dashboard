"use client";

import { useState } from "react";
import Link from "next/link";
import ImageGallery from "@/components/ImageGallery";
import AplusContent from "@/components/AplusContent";
import { LineChart } from "@/components/Charts";
import { money, number, percent } from "@/lib/format";
import { publicAsinImage } from "@/lib/images";
import type { AggregateMeta, AmazonImage, Product } from "@/lib/types";

const TABS = ["Overview", "Performance", "Content", "Reviews", "All Info"] as const;
type Tab = (typeof TABS)[number];

export default function ProductDetail({
  product,
  meta,
  totalsCurrency,
  initialTab,
}: {
  product: Product;
  meta: AggregateMeta;
  totalsCurrency: string;
  initialTab?: string;
}) {
  const start = (TABS as readonly string[]).includes(initialTab ?? "") ? (initialTab as Tab) : "Overview";
  const [tab, setTab] = useState<Tab>(start);
  const currency = product.sales?.currency ?? totalsCurrency;

  const galleryImages: AmazonImage[] = product.images.length
    ? product.images
    : [{ variant: "MAIN", link: publicAsinImage(product.asin, 600) }];

  return (
    <>
      <p className="subtle" style={{ marginBottom: 16 }}>
        <Link href="/listings?view=catalog">← Catalog</Link>
      </p>

      {/* Persistent header */}
      <div className="detail-head">
        <ImageGallery images={galleryImages} alt={product.title ?? product.asin} />
        <div>
          <h1>{product.title ?? product.asin}</h1>
          <p className="muted">{product.brand ?? "—"}</p>
          <div className="idrow">
            <span className="idchip"><b>ASIN</b>{product.asin}</span>
            {product.parentAsin && <span className="idchip"><b>Parent</b>{product.parentAsin}</span>}
            <span className="idchip"><b>Style</b>{product.style ?? "—"}</span>
            <span className="idchip"><b>Style10</b>{product.style10 ?? "—"}</span>
            {product.productType && <span className="idchip"><b>Type</b>{product.productType}</span>}
            {product.salesRank != null && (
              <span className="idchip"><b>Rank</b>#{number(product.salesRank)}{product.salesRankCategory ? ` · ${product.salesRankCategory}` : ""}</span>
            )}
          </div>
          <InsightBadge product={product} />
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            className={`tab${t === tab ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <>
          <Section title="Sales">
            <div className="kpis">
              <Kpi label="Shipped Revenue" value={money(product.sales?.shippedRevenue, currency)} />
              <Kpi label="Shipped Units" value={number(product.sales?.shippedUnits ?? null)} />
              <Kpi label="Ordered Revenue" value={money(product.sales?.orderedRevenue, currency)} />
              <Kpi label="Ordered Units" value={number(product.sales?.orderedUnits ?? null)} />
              <Kpi label="Returns" value={number(product.sales?.customerReturns ?? null)} />
            </div>
          </Section>

          {product.vendor && (
            <Section title="Pricing & Cost (from Purchase Orders)">
              <div className="kpis">
                <Kpi label="List Price" value={money(product.vendor.listPrice, product.vendor.currency)} />
                <Kpi label="Net Cost (Amazon pays you)" value={money(product.vendor.netCost, product.vendor.currency)} />
                <Kpi label="Amazon Markup" value={markup(product.vendor.listPrice, product.vendor.netCost)} />
                <Kpi label="PO Units" value={number(product.vendor.orderedUnits)} />
                <Kpi label="# POs" value={number(product.vendor.poCount)} />
                <Kpi label="Last PO" value={product.vendor.lastOrderDate ?? "—"} />
              </div>
            </Section>
          )}

          {product.poStatus && product.poStatus.orderedUnits > 0 && (
            <Section title="PO Acceptance (accepted vs cancelled)">
              <div className="kpis">
                <Kpi label="Ordered" value={number(product.poStatus.orderedUnits)} />
                <Kpi label="Accepted" value={number(product.poStatus.acceptedUnits)} />
                <Kpi label="Cancelled" value={number(product.poStatus.cancelledUnits)} />
                <Kpi
                  label="Accept Rate"
                  value={product.poStatus.orderedUnits > 0 ? `${((product.poStatus.acceptedUnits / product.poStatus.orderedUnits) * 100).toFixed(0)}%` : "—"}
                />
                <Kpi label="Unconfirmed" value={number(product.poStatus.unconfirmedUnits)} />
                <Kpi label="Received" value={number(product.poStatus.receivedUnits)} />
                <Kpi label="Open (acc−rcvd)" value={number(Math.max(0, product.poStatus.acceptedUnits - product.poStatus.receivedUnits))} />
              </div>
            </Section>
          )}
        </>
      )}

      {tab === "Performance" && (
        <>
          <Section title="Sales">
            {product.salesSeries.length ? (
              <div className="panel panel-pad">
                <div className="legend">
                  <span><span className="swatch" style={{ background: "var(--accent)" }} />Shipped revenue</span>
                  <span><span className="swatch" style={{ background: "var(--accent-2)" }} />Ordered revenue</span>
                </div>
                <LineChart
                  labels={product.salesSeries.map((p) => p.date)}
                  series={[
                    { name: "Shipped revenue", color: "var(--accent)", values: product.salesSeries.map((p) => p.shippedRevenue) },
                    { name: "Ordered revenue", color: "var(--accent-2)", values: product.salesSeries.map((p) => p.orderedRevenue) },
                  ]}
                  yLabel={`Revenue (${currency}) · ${meta.salesPeriod.toLowerCase()}ly`}
                />
              </div>
            ) : (
              <Empty>No sales data for this ASIN in the selected window.</Empty>
            )}
          </Section>

          <Section title="Forecast">
            {product.forecast.length ? (
              <div className="panel panel-pad">
                <div className="legend">
                  <span><span className="swatch" style={{ background: "var(--green)" }} />Mean forecast</span>
                  <span><span className="swatch" style={{ background: "var(--amber)" }} />P90</span>
                </div>
                <LineChart
                  labels={product.forecast.map((p) => p.date)}
                  series={[
                    { name: "Mean", color: "var(--green)", values: product.forecast.map((p) => p.meanUnits) },
                    { name: "P90", color: "var(--amber)", dashed: true, values: product.forecast.map((p) => p.p90Units ?? null) },
                  ]}
                  yLabel="Forecast units"
                />
              </div>
            ) : (
              <Empty>No forecast data available for this ASIN.</Empty>
            )}
          </Section>
        </>
      )}

      {tab === "Content" && (
        <>
          <div className="two-col">
            <Section title="Bullet Points">
              {product.bullets.length ? (
                <div className="panel panel-pad">
                  <ul className="bullets">
                    {product.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Empty>No bullet points. (Requires the Product Listing role.)</Empty>
              )}
            </Section>
            <Section title="Description">
              {product.description ? (
                <div className="panel panel-pad" style={{ whiteSpace: "pre-wrap" }}>
                  {product.description}
                </div>
              ) : (
                <Empty>No product description. (Requires the Product Listing role.)</Empty>
              )}
            </Section>
          </div>

          <Section title="A+ Content">
            {product.aplus.length ? (
              <div className="panel panel-pad">
                <AplusContent docs={product.aplus} />
              </div>
            ) : (
              <Empty>No A+ content published for this ASIN.</Empty>
            )}
          </Section>
        </>
      )}

      {tab === "Reviews" && <Reviews product={product} />}

      {tab === "All Info" && (
        <Section title="All Amazon Info (catalog attributes)">
          <div className="panel attr-table">
            <table>
              <tbody>
                {Object.entries(product.attributes)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, value]) => (
                    <tr key={key}>
                      <td>{key}</td>
                      <td>{renderValue(value)}</td>
                    </tr>
                  ))}
                {Object.keys(product.attributes).length === 0 && (
                  <tr>
                    <td colSpan={2} className="subtle">
                      No catalog attributes returned. (Requires the Product Listing role.)
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}

function Reviews({ product }: { product: Product }) {
  const dp = `https://www.amazon.com/dp/${product.asin}`;
  const reviewsUrl = `https://www.amazon.com/product-reviews/${product.asin}`;
  return (
    <Section title="Customer Reviews">
      <div className="panel panel-pad">
        <div className="reviews-empty">
          <div className="stars">★★★★★</div>
          <h2 style={{ margin: "6px 0" }}>Ratings &amp; reviews aren&apos;t available via SP-API</h2>
          <p className="muted" style={{ maxWidth: 560, margin: "0 auto 16px" }}>
            Amazon does not expose customer review content, star ratings, or review counts through the
            Selling Partner API. To see this product&apos;s reviews, open it on Amazon:
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <a className="btn" href={reviewsUrl} target="_blank" rel="noreferrer">
              ★ Read all reviews on Amazon
            </a>
            <a className="btn btn-ghost" href={dp} target="_blank" rel="noreferrer">
              View product page ↗
            </a>
          </div>
          <p className="subtle" style={{ marginTop: 18 }}>
            Want ratings/review counts in-dashboard? That requires a third-party review data provider
            (an external paid API) — wire one up and this section will populate.
          </p>
        </div>
      </div>
    </Section>
  );
}

function InsightBadge({ product }: { product: Product }) {
  const ins = product.insight;
  if (!ins || ins.kind === "flat") return null;
  const cls = ins.kind === "driver" ? "driver" : "drag";
  const arrow = ins.kind === "driver" ? "▲" : "▼";
  return (
    <span className={`tag ${cls}`} style={{ fontSize: 13, padding: "6px 12px" }}>
      {arrow} {ins.kind === "driver" ? "Driver" : "Drag"} · {percent(ins.deltaPct)} revenue ·{" "}
      {ins.contributionPct.toFixed(0)}% of movement
    </span>
  );
}

function markup(listPrice: number | null, netCost: number | null): string {
  if (listPrice == null || netCost == null || listPrice <= 0) return "—";
  return `${(((listPrice - netCost) / listPrice) * 100).toFixed(1)}%`;
}

function renderValue(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.map((v) => renderValue(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 18 }}>
        {value}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="panel panel-pad subtle">{children}</div>;
}
