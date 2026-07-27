// Orchestrates a full data pull from SP-API and writes the aggregated cache.
//
// Order: LWA auth → vendor sales report → forecast report → (discover ASINs) →
// per-ASIN catalog + A+ content (bounded concurrency) → aggregate → cache.
//
// Status is tracked in a module singleton AND mirrored to disk so the UI can
// poll progress across requests. A guard prevents concurrent syncs.

import { getConfig, isConfigured, accountFingerprint } from "./spapi/config";
import { getAccessToken } from "./spapi/auth";
import { fetchVendorSales } from "./spapi/vendorSales";
import { fetchVendorForecast } from "./spapi/vendorForecast";
import { fetchVendorOrders } from "./spapi/vendorOrders";
import { fetchPoStatus, type PoStatusResult } from "./spapi/vendorOrderStatus";
import { getCatalogItem, type NormalizedCatalog } from "./spapi/catalog";
import { fetchAllAplus, type AsinInfo } from "./spapi/aplus";
import { buildAggregate } from "./aggregate";
import { SpapiError } from "./spapi/client";
import { writeAggregate, writeStatus, readStatus } from "./cache";
import type { AplusDocument, ForecastPoint, SyncPhase, SyncStatus, VendorOrderInfo } from "./types";

let running = false;
let status: SyncStatus = idleStatus();

function idleStatus(): SyncStatus {
  return {
    phase: "idle",
    running: false,
    startedAt: null,
    finishedAt: null,
    message: "No sync has run yet.",
    progress: { current: 0, total: 0 },
    warnings: [],
    error: null,
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  // Prefer the in-memory status; fall back to disk after a server restart.
  if (status.phase !== "idle") return status;
  const disk = await readStatus();
  return disk ?? status;
}

function update(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  // Fire-and-forget mirror to disk.
  void writeStatus(status);
}

function setPhase(phase: SyncPhase, message: string): void {
  update({ phase, message });
}

/** Starts a sync if one isn't already running. Returns immediately. */
export function startSync(): { started: boolean; status: SyncStatus } {
  if (running) return { started: false, status };
  if (!isConfigured()) {
    status = {
      ...idleStatus(),
      phase: "error",
      error: "SP-API credentials are not configured. Add them to .env (see .env.example).",
      message: "Missing credentials.",
    };
    return { started: false, status };
  }

  running = true;
  status = {
    phase: "auth",
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: "Authenticating with Login with Amazon…",
    progress: { current: 0, total: 0 },
    warnings: [],
    error: null,
  };
  void writeStatus(status);

  // Run in the background; do not await.
  void runSync().catch((e: unknown) => {
    update({
      phase: "error",
      running: false,
      finishedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
      message: "Sync failed.",
    });
    running = false;
  });

  return { started: true, status };
}

async function runSync(): Promise<void> {
  const cfg = getConfig();
  const warnings: string[] = [];
  const note = (m: string) => update({ message: m });

  try {
    setPhase("auth", "Authenticating with Login with Amazon…");
    await getAccessToken();

    // ── Vendor sales ──
    setPhase("vendor-sales", "Requesting vendor sales report…");
    let sales;
    try {
      sales = await fetchVendorSales(note);
    } catch (e) {
      warnings.push(`Vendor sales report failed: ${errMsg(e)}`);
      sales = emptySales();
    }

    // ── Forecast ──
    setPhase("vendor-forecast", "Requesting vendor forecast report…");
    let forecast = new Map<string, ForecastPoint[]>();
    try {
      forecast = await fetchVendorForecast(note);
    } catch (e) {
      warnings.push(`Vendor forecast report failed: ${errMsg(e)}`);
    }

    // ── Vendor Orders (list price / net cost enrichment) ──
    setPhase("vendor-orders", "Fetching vendor purchase orders (price & cost)…");
    let vendorOrders = new Map<string, VendorOrderInfo>();
    try {
      vendorOrders = await fetchVendorOrders(note);
    } catch (e) {
      warnings.push(`Vendor orders failed: ${errMsg(e)}`);
    }

    // ── Vendor PO acceptance status (accepted/cancelled/unconfirmed/received) ──
    setPhase("vendor-po-status", "Fetching PO acceptance status…");
    let poStatus: PoStatusResult | null = null;
    try {
      poStatus = await fetchPoStatus(note);
    } catch (e) {
      warnings.push(`PO status failed: ${errMsg(e)}`);
    }

    // ── Determine ASIN universe ──
    const asins = new Set<string>([
      ...sales.byAsin.keys(),
      ...forecast.keys(),
      ...vendorOrders.keys(),
      ...(poStatus ? poStatus.byAsin.keys() : []),
      ...cfg.seedAsins,
    ]);
    const asinList = [...asins];

    // ── Catalog (per ASIN) ──
    // If the app lacks the Product Listing role, the first call 403s — short-circuit
    // the rest with one clear warning instead of firing thousands of dead requests.
    setPhase("catalog", `Fetching catalog data for ${asinList.length} ASIN(s)…`);
    const catalog = new Map<string, NormalizedCatalog | null>();
    let catalogOk = true;
    await pool(asinList, 3, async (asin, i) => {
      if (!catalogOk) return;
      update({ progress: { current: i + 1, total: asinList.length } });
      try {
        catalog.set(asin, await getCatalogItem(asin));
      } catch (e) {
        if (e instanceof SpapiError && e.status === 403) {
          if (catalogOk) {
            warnings.push(
              "Catalog data (Title, Images, Bullets, Description, Style/Style10, All Amazon Info) " +
                "is unavailable: 403 — your SP-API app lacks the Product Listing role. Add it and re-authorize."
            );
          }
          catalogOk = false;
        } else {
          catalog.set(asin, null);
          warnings.push(`Catalog ${asin}: ${errMsg(e)}`);
        }
      }
    });

    // ── A+ content (doc-centric) ──
    // The A+ API uses a role we DO have. Listing content documents also yields
    // each ASIN's real title + main image + parent — so we recover those even
    // when the Catalog (Product Listing) role is missing.
    setPhase("aplus", "Fetching A+ content, titles & images…");
    let aplus = new Map<string, AplusDocument[]>();
    let aplusInfo = new Map<string, AsinInfo>();
    try {
      const r = await fetchAllAplus(note);
      aplus = r.aplusByAsin;
      aplusInfo = r.infoByAsin;
    } catch (e) {
      warnings.push(`A+ content failed: ${errMsg(e)}`);
    }

    // ── Aggregate + persist ──
    setPhase("aggregating", "Aggregating and computing Drags & Drivers…");
    const agg = buildAggregate({
      sales,
      forecast,
      catalog,
      aplus,
      aplusInfo,
      vendorOrders,
      poStatus,
      seedAsins: cfg.seedAsins,
      marketplaceId: cfg.marketplaceId,
      account: accountFingerprint(),
      salesPeriod: cfg.salesPeriod,
      warnings,
      generatedAt: new Date().toISOString(),
    });
    await writeAggregate(agg);

    // Opportunistic: if a Net PPM Data Kiosk query from a prior sync has since
    // finished, collect and store it now. Non-fatal — a pending or failed pull
    // must never affect the sync's own success.
    try {
      const { checkNetPpmPull } = await import("./netPpmPull");
      await checkNetPpmPull();
    } catch {
      /* ignore — the client-side poll and the next sync will also try */
    }

    update({
      phase: "done",
      running: false,
      finishedAt: new Date().toISOString(),
      message: `Done. ${agg.products.length} product(s), ${agg.drivers.length} driver(s), ${agg.drags.length} drag(s).`,
      warnings,
      error: null,
    });
  } finally {
    running = false;
  }
}

/** Run `worker` over items with at most `limit` concurrent executions. */
async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await worker(items[cur], cur);
    }
  });
  await Promise.all(runners);
}

function emptySales() {
  return {
    byAsin: new Map(),
    totals: { shippedUnits: 0, shippedRevenue: 0, shippedCogs: 0, orderedUnits: 0, orderedRevenue: 0, customerReturns: 0, currency: "USD" },
    window: { start: "", end: "" },
  };
}

function errMsg(e: unknown): string {
  if (e instanceof SpapiError) {
    if (e.status === 403) {
      return (
        `${e.message} — 403 Unauthorized. Your SP-API app is not granted the role this data requires, ` +
        `or your refresh token was minted before the role was added. Add the role in the Developer Console ` +
        `(Brand Analytics → vendor sales/forecast reports; Product Listing → catalog & A+), then RE-AUTHORIZE ` +
        `the app to generate a new refresh token and update LWA_REFRESH_TOKEN.`
      );
    }
    return `${e.message}${e.details ? ` — ${e.details}` : ""}`;
  }
  return e instanceof Error ? e.message : String(e);
}
