// Validated access to marketplace (SP-API) configuration.
//
// This module does NOT define configuration — it reads it from the single
// config file (src/config/app.config.ts) and validates that the required
// credentials are present. Change values there / in .env, never here.
// All secrets stay server-side; this module is never imported by client code.

import { createHash } from "node:crypto";
import { marketplace, sync, marketplaceConfigured } from "@/config/app.config";

export interface SpapiConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  endpoint: string;
  lwaEndpoint: string;
  marketplaceId: string;
  /** Seller / vendor ID for the Listings Items path. Optional until you list. */
  sellerId: string;
  distributorView: "SOURCING" | "MANUFACTURING";
  sellingProgram: string;
  salesLookbackDays: number;
  poLookbackDays: number;
  salesPeriod: "DAY" | "WEEK" | "MONTH";
  /** How many recent DONE sales reports to merge for history. */
  salesMaxReports: number;
  /** Forecast horizon to keep, in weeks (bounds cache size). */
  forecastWeeks: number;
  style10Attr: string;
  styleAttr: string;
  seedAsins: string[];
}

let cached: SpapiConfig | null = null;

/** Returns the parsed config, or throws a clear error listing what's missing. */
export function getConfig(): SpapiConfig {
  if (cached) return cached;

  const missing: string[] = [];
  if (!marketplace.clientId) missing.push("LWA_CLIENT_ID");
  if (!marketplace.clientSecret) missing.push("LWA_CLIENT_SECRET");
  if (!marketplace.refreshToken) missing.push("LWA_REFRESH_TOKEN");

  if (missing.length) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill in your marketplace API credentials.`
    );
  }

  cached = {
    clientId: marketplace.clientId,
    clientSecret: marketplace.clientSecret,
    refreshToken: marketplace.refreshToken,
    endpoint: marketplace.endpoint.replace(/\/$/, ""),
    lwaEndpoint: marketplace.lwaEndpoint,
    marketplaceId: marketplace.marketplaceId,
    sellerId: marketplace.sellerId,
    distributorView: marketplace.distributorView as "SOURCING" | "MANUFACTURING",
    sellingProgram: marketplace.sellingProgram,
    salesLookbackDays: sync.salesLookbackDays,
    poLookbackDays: sync.poLookbackDays,
    salesPeriod: sync.salesPeriod as "DAY" | "WEEK" | "MONTH",
    salesMaxReports: sync.salesMaxReports,
    forecastWeeks: sync.forecastWeeks,
    style10Attr: marketplace.style10Attr,
    styleAttr: marketplace.styleAttr,
    seedAsins: sync.seedAsins,
  };
  return cached;
}

/** True when the minimum credentials are present, without throwing. */
export function isConfigured(): boolean {
  return marketplaceConfigured();
}

/**
 * Stable, non-secret fingerprint of the active account (client + marketplace +
 * refresh token). Stamped onto the cache so swapping .env auto-invalidates a
 * previous vendor's cached data instead of showing it to the new user.
 */
export function accountFingerprint(): string {
  const raw = [
    marketplace.clientId,
    marketplace.marketplaceId,
    marketplace.refreshToken,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}


export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
