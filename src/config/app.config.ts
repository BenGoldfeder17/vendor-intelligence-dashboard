// ─────────────────────────────────────────────────────────────────────────────
//  THE SINGLE CONFIGURATION FILE
// ─────────────────────────────────────────────────────────────────────────────
//
//  Everything tenant-specific, environment-specific, or otherwise alterable
//  lives here. Nothing else in the codebase should hardcode a company name, a
//  margin threshold, a table name, a bucket, or a suppression code.
//
//  Every value reads from an environment variable with a sensible default, so
//  the app is configured entirely by a `.env` file (or by real environment
//  variables in a container/orchestrator). See `.env.example` for the full,
//  documented list.
//
//  Deployment portability: nothing here assumes a cloud provider. The storage
//  driver is selectable (local disk / S3-compatible / Google Cloud Storage), and
//  the data-warehouse integration is optional. The app runs unchanged on a bare
//  VM with Docker, an SSH server with Node, AWS (ECS/App Runner/EC2), GCP
//  (Cloud Run/GCE), Azure, Fly.io, Render, or a laptop.
// ─────────────────────────────────────────────────────────────────────────────

// ── helpers ──────────────────────────────────────────────────────────────────

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? "").trim() || fallback;
}

function int(name: string, fallback: number, min = -Infinity, max = Infinity): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Percentages accept either a fraction ("0.3275") or a percent ("32.75" / "32.75%").
 * Anything with a magnitude above 1.5 is treated as a percent — margins are never
 * legitimately above 150% as a fraction, so this disambiguation is safe.
 */
function pct(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim().replace("%", "");
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.abs(n) > 1.5 ? n / 100 : n;
}

function bool(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Comma-separated list → trimmed, non-empty entries. */
function list(name: string, fallback: string[] = []): string[] {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse a "KEY:value,KEY:value" map from env. Used for the suppression-code
 * dictionary, which is entirely vendor-specific.
 */
function codeMap(name: string, fallback: Record<string, string>): Record<string, string> {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split(":").map((s) => s?.trim());
    if (k && v) out[k.toUpperCase()] = v.toLowerCase();
  }
  return Object.keys(out).length ? out : fallback;
}

// ── 1. Identity & branding ───────────────────────────────────────────────────
//
// The app ships with neutral defaults. Set these to your organisation's values.

export const identity = {
  /** Short mark shown in the top-left of the nav (e.g. "AVC"). */
  appMark: str("APP_MARK", "AVC"),
  /** Full product name, used in titles and headings. */
  appName: str("APP_NAME", "Vendor Intelligence"),
  /** Your organisation's display name. Used in copy like "what {org} is unlisting". */
  orgName: str("ORG_NAME", "your company"),

  /**
   * Own-brand vs other-brand segmentation. The dashboard splits PO confirmation
   * and catalog metrics between products you manufacture and products you
   * distribute for other brands. These are display labels only.
   */
  ownBrandLabel: str("OWN_BRAND_LABEL", "Own brand"),
  otherBrandLabel: str("OTHER_BRAND_LABEL", "Other brands"),

  /**
   * Case-insensitive tokens that identify an own-brand product when a Brand
   * column is absent (matched against brand field, then product title).
   * e.g. "acme,acme-pro"
   */
  ownBrandMatchers: list("OWN_BRAND_MATCHERS", []).map((s) => s.toLowerCase()),

  /**
   * Your direct-to-consumer storefront. Used by the self-undercut check, which
   * compares your own advertised price against the marketplace ASP.
   */
  dtcSiteName: str("DTC_SITE_NAME", "your DTC site"),
  dtcSiteUrl: str("DTC_SITE_URL", ""),
} as const;

// ── 2. Marketplace API (Amazon SP-API) ───────────────────────────────────────

export const marketplace = {
  endpoint: str("SPAPI_ENDPOINT", "https://sellingpartnerapi-na.amazon.com"),
  lwaEndpoint: str("SPAPI_LWA_ENDPOINT", "https://api.amazon.com/auth/o2/token"),
  marketplaceId: str("SPAPI_MARKETPLACE_ID", "ATVPDKIKX0DER"),

  /** Vendor/seller id — required in the Listings Items path when submitting. */
  sellerId: str("SPAPI_SELLER_ID"),

  /** SOURCING (units sourced via your vendor codes) or MANUFACTURING. */
  distributorView: str("SPAPI_DISTRIBUTOR_VIEW", "SOURCING"),
  sellingProgram: str("SPAPI_SELLING_PROGRAM", "RETAIL"),

  /** Credentials. Keep these in a secret store, never in source control. */
  clientId: str("LWA_CLIENT_ID"),
  clientSecret: str("LWA_CLIENT_SECRET"),
  refreshToken: str("LWA_REFRESH_TOKEN"),

  /** Catalog attribute names that carry your internal style/SKU codes. */
  styleAttr: str("STYLE_ATTR", "model_number"),
  style10Attr: str("STYLE10_ATTR", "part_number"),
} as const;

export function marketplaceConfigured(): boolean {
  return Boolean(marketplace.clientId && marketplace.clientSecret && marketplace.refreshToken);
}

// ── 3. Sync tuning ───────────────────────────────────────────────────────────

export const sync = {
  /** How far back to request sales data. 180 days ≈ 26 weekly periods. */
  salesLookbackDays: int("SALES_LOOKBACK_DAYS", 180, 1, 730),
  /** Max existing reports to reuse before forcing a fresh full-window report. */
  salesMaxReports: int("SALES_MAX_REPORTS", 26, 1, 200),
  /** DAY | WEEK | MONTH. WEEK aligns sales with PO buckets. */
  salesPeriod: str("SALES_PERIOD", "WEEK"),
  poLookbackDays: int("PO_LOOKBACK_DAYS", 365, 1, 730),
  forecastWeeks: int("FORECAST_WEEKS", 26, 1, 104),
  /** Optional comma-separated ASINs to seed the catalog before first sync. */
  seedAsins: list("SEED_ASINS"),
} as const;

// ── 5. Margin & risk thresholds  (commercial policy — set to YOUR numbers) ───

export const thresholds = {
  /**
   * Fallback Net PPM floor, used when a vendor code has no contract entry in
   * section 5b. If your terms differ by vendor code — they usually do — set the
   * real per-code floors there rather than relying on this one number.
   */
  netPpmFloor: pct("NET_PPM_FLOOR", 0.3275),

  /**
   * Healthy gross-margin benchmark for the silent-CRaP detector. Marketplace
   * norms differ by category (softlines vs hardlines), so this is the default
   * and the UI lets you switch it per-view.
   */
  marginBenchmark: pct("MARGIN_BENCHMARK", 0.35),

  /**
   * PO velocity decline that counts as "the marketplace quietly stopped buying".
   * -0.30 = a 30% drop between comparison windows.
   */
  poDecayThreshold: pct("PO_DECAY_THRESHOLD", -0.3),

  /**
   * Margin below this is treated as a broken data tail and excluded from blends
   * so it can't wreck a revenue-weighted average.
   */
  brokenTailFloor: pct("BROKEN_TAIL_FLOOR", -1.0),

  /** Headroom (in points) below which the floor gauge shows amber instead of green. */
  amberHeadroomPts: int("AMBER_HEADROOM_PTS", 2, 0, 100),

  /** Confirmation-rate thresholds for triage severity. */
  confirmationWatchRate: pct("CONFIRMATION_WATCH_RATE", 0.85),
  confirmationActionRate: pct("CONFIRMATION_ACTION_RATE", 0.75),
} as const;

// ── 5b. Vendor contracts  (PER VENDOR CODE — this is where real terms live) ──
//
// Trade terms are what turn a GROSS margin into the marketplace's NET margin.
// The marketplace deducts allowances from what it pays you (co-op, early-payment
// discount, damage allowance, freight, returns provision). Those deductions
// reduce ITS effective cost, so they RAISE its net margin above gross:
//
//     Net PPM  ≈  Gross PPM  +  (total allowances as a % of revenue)
//
// The marketplace reports a Net PPM built on its own ESTIMATE of those
// allowances. Because you know the actual contracted percentages, the figure
// computed here is more accurate than the one it shows you.
//
// Terms almost always differ by vendor code, so each code gets its own entry and
// its own floor. Anything omitted from an entry inherits from `default`.
//
// ─── EDIT THIS BLOCK. It is the one place contracts are defined. ─────────────

export interface ContractTerms {
  /** Net PPM floor negotiated for this vendor code (fraction, e.g. 0.3275). */
  floor: number;
  /** Co-op / marketing accrual, as a fraction of revenue. */
  coopPct: number;
  /** Early-payment / prompt-pay discount (e.g. 0.02 for "2% net 30"). */
  paymentTermsPct: number;
  /** Damage / defective allowance. */
  damageAllowancePct: number;
  /** Freight allowance, if you fund freight. */
  freightPct: number;
  /** Returns provision / RA allowance. */
  returnsProvisionPct: number;
}

/** Applied to any vendor code with no explicit entry below. */
const defaultContract: ContractTerms = {
  floor: pct("CONTRACT_DEFAULT_FLOOR", thresholds.netPpmFloor),
  coopPct: pct("CONTRACT_DEFAULT_COOP_PCT", 0),
  paymentTermsPct: pct("CONTRACT_DEFAULT_PAYMENT_TERMS_PCT", 0),
  damageAllowancePct: pct("CONTRACT_DEFAULT_DAMAGE_PCT", 0),
  freightPct: pct("CONTRACT_DEFAULT_FREIGHT_PCT", 0),
  returnsProvisionPct: pct("CONTRACT_DEFAULT_RETURNS_PCT", 0),
};

/**
 * Per-vendor-code contracts, supplied via the VENDOR_CONTRACTS key in env.yaml
 * as a JSON object. Keys are the Brand/Vendor Code exactly as it appears in your
 * Net PPM export (matched case-insensitively). Partial entries are fine —
 * omitted fields inherit from `defaultContract`.
 *
 * env.yaml:
 *   VENDOR_CONTRACTS: '{"ABCDE":{"floor":0.30,"coopPct":0.08},"FGHIJ":{"floor":0.35}}'
 *
 * Carried as JSON rather than nested YAML because Cloud Run's --env-vars-file
 * only accepts a flat map. Values may be fractions (0.30) or percents (30).
 */
function parseVendorContracts(): Record<string, Partial<ContractTerms>> {
  const raw = (process.env.VENDOR_CONTRACTS ?? "").trim();
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, Record<string, number>>;
    const out: Record<string, Partial<ContractTerms>> = {};
    for (const [code, terms] of Object.entries(obj)) {
      const t: Partial<ContractTerms> = {};
      for (const [k, v] of Object.entries(terms)) {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        // Same fraction-vs-percent disambiguation used everywhere else.
        (t as Record<string, number>)[k] = Math.abs(v) > 1.5 ? v / 100 : v;
      }
      out[code] = t;
    }
    return out;
  } catch {
    // Malformed JSON must not crash the app: fall back to defaults for every
    // code. /api/health reports that no per-code contracts are configured.
    return {};
  }
}

const vendorContracts: Record<string, Partial<ContractTerms>> = parseVendorContracts();

/** Case-insensitive lookup index, built once. */
const contractIndex: Map<string, ContractTerms> = new Map(
  Object.entries(vendorContracts).map(([code, partial]) => [
    code.trim().toUpperCase(),
    { ...defaultContract, ...partial },
  ])
);

/** Resolve the contract for a vendor code, falling back to the default terms. */
export function contractFor(vendorCode: string | null | undefined): ContractTerms {
  if (!vendorCode) return defaultContract;
  return contractIndex.get(vendorCode.trim().toUpperCase()) ?? defaultContract;
}

/** True when at least one per-code contract is configured. */
export function hasPerCodeContracts(): boolean {
  return contractIndex.size > 0;
}

/** Every configured vendor code, for diagnostics and the health endpoint. */
export function configuredVendorCodes(): string[] {
  return [...contractIndex.keys()].sort();
}

/**
 * Total allowances as a fraction of revenue — the amount by which the
 * marketplace's NET margin exceeds its GROSS margin on your product.
 */
export function totalAllowancePct(terms: ContractTerms): number {
  return (
    terms.coopPct +
    terms.paymentTermsPct +
    terms.damageAllowancePct +
    terms.freightPct +
    terms.returnsProvisionPct
  );
}

export const contracts = {
  default: defaultContract,
  byVendorCode: vendorContracts,
  contractFor,
  hasPerCodeContracts,
  configuredVendorCodes,
  totalAllowancePct,
} as const;

// ── 5. Suppression / cancellation code dictionary ────────────────────────────
//
// Entirely vendor-specific: these letters come from YOUR item-master feed.
// Classes: "margin" | "operational" | "not_suppressed" | "unknown".
//
// Override with e.g.
//   SUPPRESSION_CODES="M:margin,P:margin,D:operational,N:not_suppressed"
//
// The shipped default reflects a common vendor pattern; verify against your own
// system's legend before trusting the suppression ledger.

export const suppressionCodes: Record<string, string> = codeMap("SUPPRESSION_CODES", {
  M: "margin",
  P: "margin",
  D: "operational",
  F: "operational",
  H: "operational",
  I: "operational",
  Q: "operational",
  S: "operational",
  V: "operational",
  W: "operational",
  Y: "operational",
  N: "not_suppressed",
});

/** Human-readable names for the codes, shown in the suppression ledger. */
export const suppressionCodeNames: Record<string, string> = codeMap("SUPPRESSION_CODE_NAMES", {
  M: "Margin",
  P: "Net margin",
  D: "Discontinued",
  F: "MOI/Factor",
  H: "Hazmat",
  I: "Inventory control",
  Q: "Quality control",
  S: "Seasonality",
  V: "Vendor prohibits",
  W: "Warehouse impact",
  Y: "Send zero inventory",
  N: "Send inventory",
});

/**
 * PO cancellation codes that mean "we suppressed this line". This is a SEPARATE
 * dictionary from the suppression flags above — the same letter can mean
 * different things in the two systems, so they are deliberately not merged.
 * The code that means "accepted / no problem" is excluded here.
 */
export const poAcceptCode = str("PO_ACCEPT_CODE", "N").toUpperCase();

// ── 6. Storage ───────────────────────────────────────────────────────────────
//
// Driver selection is what makes this deployable anywhere:
//   local — plain filesystem. Works on any VM, container, or laptop. Default.
//   s3    — any S3-compatible object store (AWS S3, MinIO, Cloudflare R2, Wasabi).
//   gcs   — Google Cloud Storage.
//
// The cloud SDKs are dynamically imported and only load when selected, so a
// local or S3 deployment never pulls in the Google libraries and vice versa.

export type StorageDriver = "local" | "s3" | "gcs";

export const storage = {
  driver: (str("STORAGE_DRIVER", "local") as StorageDriver),

  /** Key prefix applied to every object, so one bucket can host several apps. */
  prefix: str("STORAGE_PREFIX", ""),

  /** local */
  localDir: str("STORAGE_LOCAL_DIR", ".data"),

  /** s3 / gcs — bucket name. */
  bucket: str("STORAGE_BUCKET", str("GCS_BUCKET")),

  /** s3 only */
  s3Region: str("S3_REGION", str("AWS_REGION", "us-east-1")),
  /** Set for S3-compatible stores that aren't AWS (MinIO, R2, Wasabi). */
  s3Endpoint: str("S3_ENDPOINT"),
  s3ForcePathStyle: bool("S3_FORCE_PATH_STYLE", false),

  /**
   * Publicly-readable bucket for product images. The marketplace must be able to
   * fetch image URLs, so a private/auth-gated bucket won't work for live listing
   * submission. Leave empty to serve images through the app instead (fine for
   * drafting, not for submission).
   */
  publicImageBucket: str("PUBLIC_IMAGE_BUCKET", str("GCS_IMAGE_BUCKET")),
  publicImageBaseUrl: str("PUBLIC_IMAGE_BASE_URL"),
} as const;

// ── 7. Data warehouse (optional) ─────────────────────────────────────────────
//
// Powers the suppression ledger and fill-risk panels. Entirely optional — the
// margin panels work without it. Currently implements BigQuery; the query layer
// is isolated so another warehouse can be added without touching the panels.

export const warehouse = {
  enabled: bool("WAREHOUSE_ENABLED", Boolean(str("BQ_PROJECT"))),
  driver: str("WAREHOUSE_DRIVER", "bigquery"),

  project: str("BQ_PROJECT", str("GOOGLE_CLOUD_PROJECT", str("GCLOUD_PROJECT"))),
  /** Read-only source dataset holding your item master / inventory feeds. */
  sourceDataset: str("WAREHOUSE_SOURCE_DATASET", str("BQ_FEEDS_DATASET", "vendor_feeds")),
  /** App-owned dataset for snapshots. The ONLY place this app ever writes. */
  snapshotDataset: str("WAREHOUSE_SNAPSHOT_DATASET", str("BQ_SNAPSHOT_DATASET", "avc_risk_monitor")),
  location: str("WAREHOUSE_LOCATION", str("BQ_LOCATION", "US")),

  /** Table names in the source dataset — rename to match your warehouse. */
  tables: {
    priceFile: str("TABLE_PRICE_FILE", "price_file"),
    inventory: str("TABLE_INVENTORY", "inventory"),
    asinStyleMap: str("TABLE_ASIN_STYLE_MAP", "asin_style_map"),
    catalog: str("TABLE_CATALOG", "catalog_sourcing"),
  },

  /** Column names, in case your warehouse uses different casing/naming. */
  columns: {
    style: str("COL_STYLE", "Style"),
    asin: str("COL_ASIN", "ASIN"),
    suppressionFlags: str("COL_SUPPRESSION_FLAGS", "SendZeroFlags"),
    replenishmentCode: str("COL_REPLENISHMENT_CODE", "ReplenishmentCode"),
    qtyOnHand: str("COL_QTY_ON_HAND", "QtyOnHand"),
    qtyOnOrder: str("COL_QTY_ON_ORDER", "QtyOnOrder"),
    qtyInRoute: str("COL_QTY_IN_ROUTE", "QtyInRoute"),
  },
} as const;

// ── 8. Security ──────────────────────────────────────────────────────────────

export const security = {
  /**
   * Shared secret protecting the snapshot endpoint (the only route that writes
   * to the warehouse). Generate with: openssl rand -hex 32
   * If empty, the endpoint relies solely on your platform's auth layer.
   */
  snapshotToken: str("SNAPSHOT_TOKEN"),
} as const;

// ── 8b. Deployment identity ──────────────────────────────────────────────────
//
// Where this instance is deployed. These are the values that otherwise live only
// in shell history and have to be re-exported on every SSH session. Keeping them
// here means the deploy scripts, the health endpoint and any tooling read one
// source instead of drifting apart.
//
// NOTHING HERE IS USED AT REQUEST TIME — the app runs identically without it.
// It exists so deployment is reproducible rather than remembered.
//
// `scripts/deploy-env.sh` turns this into shell exports:
//     source scripts/deploy-env.sh

export const deployment = {
  /** gcp | aws | azure | fly | ssh | other — selects which fields matter. */
  platform: str("DEPLOY_PLATFORM", "other"),

  /** Logical service name (Cloud Run service, App Runner service, systemd unit). */
  serviceName: str("DEPLOY_SERVICE", "vendor-dashboard"),

  /** Region or location, e.g. us-central1 / us-east-1. */
  region: str("DEPLOY_REGION", ""),

  /** Public URL of the deployed service, once known. */
  serviceUrl: str("DEPLOY_SERVICE_URL", ""),

  /** Cloud project (GCP project id) or AWS account id. */
  projectId: str("DEPLOY_PROJECT_ID", ""),

  /** GCP numeric project number, where the platform needs it. */
  projectNumber: str("DEPLOY_PROJECT_NUMBER", ""),

  /**
   * Runtime identity the service runs as: a GCP service-account short name, or
   * an AWS task/instance role. Prefer this over static credentials.
   */
  runtimeIdentity: str("DEPLOY_RUNTIME_IDENTITY", ""),

  /** Container image reference (registry path), if you push images. */
  imageRef: str("DEPLOY_IMAGE", ""),

  /** Scaling / runtime shape, for platforms that take them. */
  minInstances: int("DEPLOY_MIN_INSTANCES", 1, 0, 100),
  maxInstances: int("DEPLOY_MAX_INSTANCES", 1, 1, 1000),
  memory: str("DEPLOY_MEMORY", "1Gi"),
  timeoutSeconds: int("DEPLOY_TIMEOUT_SECONDS", 3600, 1, 3600),
} as const;

/**
 * Fully-qualified runtime identity for the configured platform.
 * GCP → service-account email, expanded from the short name. Otherwise raw.
 */
export function runtimeIdentityFull(): string {
  const d = deployment;
  if (!d.runtimeIdentity) return "";
  if (d.platform === "gcp" && d.projectId && !d.runtimeIdentity.includes("@")) {
    return `${d.runtimeIdentity}@${d.projectId}.iam.gserviceaccount.com`;
  }
  return d.runtimeIdentity;
}

// ── 9. CSV import aliases ────────────────────────────────────────────────────
//
// Header names vary between exports. Extra aliases can be appended via env
// without touching code, e.g. EXTRA_ALIAS_WEB_PRICE="rrp,shelf price".

export const csvAliases = {
  asin: ["asin", "asin id", "child asin", ...list("EXTRA_ALIAS_ASIN")],
  style: ["style", "style code", "sku", "model", "part number", ...list("EXTRA_ALIAS_STYLE")],
  brand: ["brand", "brand flag", "brand name", "manufacturer", ...list("EXTRA_ALIAS_BRAND")],
  code: ["code", "cancel code", "cancellation code", "reason code", ...list("EXTRA_ALIAS_CODE")],
  onHand: [
    "on hand", "onhand", "on-hand", "qty on hand", "available", "inventory",
    "ecomm on hand", "ecomm onhand",
    ...list("EXTRA_ALIAS_ON_HAND"),
  ],
  webPrice: [
    "web price", "webprice", "dtc price", "site price", "list price", "advertised price",
    ...list("EXTRA_ALIAS_WEB_PRICE"),
  ],
  packSize: [
    "pack size", "packsize", "units per pack", "uom qty", "pack qty", "case qty", "units",
    ...list("EXTRA_ALIAS_PACK_SIZE"),
  ],
} as const;

// ── convenience: one object for anything that wants "the whole config" ───────

export const appConfig = {
  identity,
  marketplace,
  sync,
  thresholds,
  suppressionCodes,
  suppressionCodeNames,
  poAcceptCode,
  storage,
  warehouse,
  security,
  deployment,
  csvAliases,
} as const;

export default appConfig;
