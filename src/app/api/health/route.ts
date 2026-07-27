import { NextResponse } from "next/server";
import { storageHealth } from "@/lib/storage";
import { marketplaceConfigured } from "@/config/app.config";
import { identity, thresholds, warehouse, storage, sync, marketplace, hasPerCodeContracts, configuredVendorCodes, deployment } from "@/config/app.config";
import { bigQueryEnabled } from "@/lib/bigquery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — configuration + connectivity check.
 *
 * Platform-agnostic: use it to verify a deployment on any host. Reports what is
 * configured and what is missing, WITHOUT ever echoing a secret.
 */
export async function GET() {
  const store = await storageHealth();

  const checks = {
    marketplaceCredentials: marketplaceConfigured(),
    sellerIdSet: Boolean(marketplace.sellerId),
    storageWritable: store.ok,
    warehouseEnabled: bigQueryEnabled(),
  };

  const ready = checks.marketplaceCredentials && checks.storageWritable;

  return NextResponse.json({
    ready,
    app: { name: identity.appName, mark: identity.appMark, org: identity.orgName },
    checks,
    storage: { driver: store.driver, ok: store.ok, detail: store.detail },
    warehouse: {
      enabled: bigQueryEnabled(),
      sourceDataset: warehouse.sourceDataset,
      tables: warehouse.tables,
    },
    deployment: {
      platform: deployment.platform,
      service: deployment.serviceName,
      region: deployment.region,
      url: deployment.serviceUrl,
    },
    contracts: {
      perCodeConfigured: hasPerCodeContracts(),
      vendorCodes: configuredVendorCodes(),
    },
    thresholds: {
      fallbackNetPpmFloor: thresholds.netPpmFloor,
      marginBenchmark: thresholds.marginBenchmark,
      poDecayThreshold: thresholds.poDecayThreshold,
    },
    sync: {
      salesLookbackDays: sync.salesLookbackDays,
      salesMaxReports: sync.salesMaxReports,
      salesPeriod: sync.salesPeriod,
    },
    hints: [
      !checks.marketplaceCredentials && "Set LWA_CLIENT_ID / LWA_CLIENT_SECRET / LWA_REFRESH_TOKEN.",
      !checks.storageWritable && `Storage (${storage.driver}) is not writable: ${store.detail}`,
      !checks.sellerIdSet && "SPAPI_SELLER_ID is unset — required only to submit listings.",
      !checks.warehouseEnabled && "Warehouse disabled — suppression ledger and fill risk are hidden.",
      !hasPerCodeContracts() &&
        "No per-vendor-code contracts configured — every code is judged against the fallback floor, which mis-ranks codes when terms differ. See app.config.ts § 5b.",
    ].filter(Boolean),
  });
}
