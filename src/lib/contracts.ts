// Vendor contract store.
//
// WHY THIS IS NOT CONFIGURATION:
// Contract terms are business DATA, not deploy-time settings. They change when
// terms are renegotiated, they get reviewed and corrected, and the person who
// knows them may not be the person who deploys. Requiring a redeploy — or a
// hand-encoded JSON blob in a secret manager — to change a margin floor is the
// wrong shape.
//
// So contracts live in the same storage layer as the rest of the app's data
// (local disk / S3 / GCS), behind whatever auth fronts the app, and are edited
// through the UI. No redeploy, no JSON hand-editing, and they are reviewable.
//
// PRECEDENCE (highest wins):
//   1. contracts.json in the storage layer   ← the UI writes here
//   2. VENDOR_CONTRACTS environment variable ← legacy / bootstrap
//   3. CONTRACT_DEFAULT_* fallback terms
//
// Keeping (2) means existing deployments that inject contracts as a secret keep
// working, and it gives a way to seed an environment without a UI round-trip.

import { readJson, writeJson } from "./storage";
import {
  contracts as configContracts,
  type ContractTerms,
} from "@/config/app.config";

const KEY = "contracts.json";

export interface StoredContracts {
  meta: {
    updatedAt: string;
    updatedBy?: string;
    codeCount: number;
  };
  /** vendor code (upper-case) → partial terms; omitted fields inherit defaults. */
  byVendorCode: Record<string, Partial<ContractTerms>>;
}

/** The six terms a contract can carry, with display metadata for the editor. */
export const CONTRACT_FIELDS = [
  { key: "floor", label: "Net PPM floor", hint: "The margin floor negotiated for this code" },
  { key: "coopPct", label: "Co-op / marketing", hint: "Accrual as a % of revenue" },
  { key: "paymentTermsPct", label: "Payment terms", hint: "Early-payment discount, e.g. 2% net 30" },
  { key: "damageAllowancePct", label: "Damage allowance", hint: "Damaged/defective allowance" },
  { key: "freightPct", label: "Freight", hint: "Freight allowance, if you fund it" },
  { key: "returnsProvisionPct", label: "Returns provision", hint: "Returns / RA allowance" },
] as const;

export type ContractFieldKey = (typeof CONTRACT_FIELDS)[number]["key"];

/**
 * Normalise a user-entered number. Accepts a fraction (0.30) or a percent (30),
 * matching the convention used everywhere else in the app. Values above 1.5 are
 * treated as percents — a margin is never legitimately above 150% as a fraction.
 */
export function normaliseTerm(v: number): number {
  return Math.abs(v) > 1.5 ? v / 100 : v;
}

/** Validate and clean a submitted contract map. Returns errors rather than throwing. */
export function validateContracts(input: unknown): {
  ok: boolean;
  cleaned: Record<string, Partial<ContractTerms>>;
  errors: string[];
} {
  const errors: string[] = [];
  const cleaned: Record<string, Partial<ContractTerms>> = {};

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, cleaned: {}, errors: ["Expected an object of vendor codes."] };
  }

  const validKeys = new Set(CONTRACT_FIELDS.map((f) => f.key as string));

  for (const [rawCode, rawTerms] of Object.entries(input as Record<string, unknown>)) {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      errors.push("A vendor code is empty.");
      continue;
    }
    if (!/^[A-Z0-9._-]+$/.test(code)) {
      errors.push(`"${rawCode}" is not a valid vendor code (letters, digits, . _ - only).`);
      continue;
    }
    if (!rawTerms || typeof rawTerms !== "object") {
      errors.push(`${code}: terms must be an object.`);
      continue;
    }

    const terms: Partial<ContractTerms> = {};
    for (const [k, v] of Object.entries(rawTerms as Record<string, unknown>)) {
      if (!validKeys.has(k)) {
        errors.push(`${code}: unknown field "${k}".`);
        continue;
      }
      if (v === null || v === "" || v === undefined) continue; // omitted → inherit
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) {
        errors.push(`${code}.${k}: "${String(v)}" is not a number.`);
        continue;
      }
      const norm = normaliseTerm(n);
      // A floor outside 0-100% or an allowance outside -100..100% is almost
      // certainly a typo (e.g. 300 meant as 30). Catch it before it skews a panel.
      if (k === "floor" && (norm < 0 || norm > 1)) {
        errors.push(`${code}.floor: ${n} resolves to ${(norm * 100).toFixed(1)}% — expected 0-100%.`);
        continue;
      }
      if (k !== "floor" && (norm < -1 || norm > 1)) {
        errors.push(`${code}.${k}: ${n} resolves to ${(norm * 100).toFixed(1)}% — expected -100..100%.`);
        continue;
      }
      (terms as Record<string, number>)[k] = norm;
    }

    if (Object.keys(terms).length === 0) {
      errors.push(`${code}: no valid terms — remove the code or give it at least one value.`);
      continue;
    }
    cleaned[code] = terms;
  }

  return { ok: errors.length === 0, cleaned, errors };
}

// ── module cache, so contractFor() can stay synchronous ──────────────────────

let cache: Record<string, Partial<ContractTerms>> | null = null;
let cacheLoadedAt = 0;
const CACHE_MS = 10_000;

/**
 * Load contracts from storage into the cache. Call this at the start of any
 * request that computes margin, before using resolveContract().
 */
export async function refreshContracts(force = false): Promise<Record<string, Partial<ContractTerms>>> {
  const now = Date.now();
  if (!force && cache && now - cacheLoadedAt < CACHE_MS) return cache;

  let stored: StoredContracts | null = null;
  try {
    stored = await readJson<StoredContracts>(KEY);
  } catch {
    /* storage unavailable → fall through to env/config */
  }

  const fromStorage = stored?.byVendorCode ?? null;
  // Storage wins; otherwise fall back to whatever the config picked up from env.
  cache =
    fromStorage && Object.keys(fromStorage).length > 0
      ? fromStorage
      : (configContracts.byVendorCode as Record<string, Partial<ContractTerms>>);
  cacheLoadedAt = now;
  return cache;
}

/** Persist contracts and refresh the cache. */
export async function saveContracts(
  byVendorCode: Record<string, Partial<ContractTerms>>,
  updatedBy?: string
): Promise<StoredContracts> {
  const doc: StoredContracts = {
    meta: {
      updatedAt: new Date().toISOString(),
      updatedBy,
      codeCount: Object.keys(byVendorCode).length,
    },
    byVendorCode,
  };
  await writeJson(KEY, doc);
  cache = byVendorCode;
  cacheLoadedAt = Date.now();
  return doc;
}

export async function readStoredContracts(): Promise<StoredContracts | null> {
  try {
    return await readJson<StoredContracts>(KEY);
  } catch {
    return null;
  }
}

/**
 * Resolve full terms for a vendor code from the cache, inheriting anything
 * omitted from the configured defaults. Synchronous — call refreshContracts()
 * first in the request.
 */
export function resolveContract(vendorCode: string | null | undefined): ContractTerms {
  const defaults = configContracts.default;
  if (!vendorCode) return defaults;
  const partial = (cache ?? {})[vendorCode.trim().toUpperCase()];
  return partial ? { ...defaults, ...partial } : defaults;
}

/** True when at least one per-code contract is loaded. */
export function hasContracts(): boolean {
  return Boolean(cache && Object.keys(cache).length > 0);
}

/** Where the currently-loaded contracts came from — surfaced in the UI. */
export async function contractSource(): Promise<"storage" | "environment" | "none"> {
  const stored = await readStoredContracts();
  if (stored && Object.keys(stored.byVendorCode).length > 0) return "storage";
  if (Object.keys(configContracts.byVendorCode).length > 0) return "environment";
  return "none";
}
