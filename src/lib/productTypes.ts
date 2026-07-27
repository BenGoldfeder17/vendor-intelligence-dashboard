// Product Type Definitions API (2020-09-01).
//
// Amazon describes every product type with a JSON Schema listing its attributes,
// which values are valid, and which are required. We fetch that schema and
// normalize it into a flat list of form fields the UI can render. The schema is
// the source of truth — nothing about gloves (or any category) is hardcoded here.
//
// The normalized schema is cached in storage (GCS on Cloud Run) because the raw
// document is ~1MB and rarely changes. Amazon's PRODUCT_TYPE_DEFINITIONS_CHANGE
// notification is the signal to refresh it; until that's wired, a TTL + a manual
// "refresh" flag cover it.

import { getConfig } from "./spapi/config";
import { getAccessToken } from "./spapi/auth";
import { readJson, writeJson } from "./storage";

const SCHEMA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ProductTypeSummary {
  name: string;
  displayName: string;
}

export interface FieldOption {
  value: string;
  label: string;
}

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "boolean"
  | "select"
  | "measure"
  | "image"
  | "unsupported";

export interface FormField {
  name: string;
  title: string;
  description?: string;
  group: string;
  required: boolean;
  kind: FieldKind;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  options?: FieldOption[];
  units?: FieldOption[];
  examples?: string[];
  /**
   * Which key inside the entry object holds the value. Almost always "value",
   * but image locators use "media_location" instead.
   */
  valueKey: "value" | "media_location";
  /** URL pattern for image locators, e.g. ^(https?|s3):// */
  pattern?: string;
  /** The schema's entry object carries these — we fill them automatically. */
  hasLanguageTag: boolean;
  hasMarketplaceId: boolean;
  /** Set when kind === "unsupported": why this field can't be rendered here. */
  reason?: string;
}

export interface NormalizedSchema {
  productType: string;
  fetchedAt: string;
  groups: string[];
  fields: FormField[];
  requiredCount: number;
  unsupportedCount: number;
}

// ─── SP-API calls ──────────────────────────────────────────────────────────

async function spapiGet(path: string): Promise<Response> {
  const cfg = getConfig();
  const token = await getAccessToken();
  return fetch(`${cfg.endpoint}${path}`, {
    headers: { "x-amz-access-token": token },
    cache: "no-store",
  });
}

/**
 * The COMPLETE product type list for the marketplace. searchDefinitionsProductTypes
 * with no keywords returns everything Amazon offers — several thousand types.
 * Cached, because it's large and changes rarely.
 */
export async function listAllProductTypes(force = false): Promise<ProductTypeSummary[]> {
  const key = "product-types-all.json";
  if (!force) {
    const cached = await readJson<{ fetchedAt: string; types: ProductTypeSummary[] }>(key);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < SCHEMA_TTL_MS) return cached.types;
  }
  const types = await searchProductTypes();
  await writeJson(key, { fetchedAt: new Date().toISOString(), types });
  return types;
}

/** searchDefinitionsProductTypes — omit keywords to get every type. */
export async function searchProductTypes(keywords?: string): Promise<ProductTypeSummary[]> {
  const cfg = getConfig();
  const qs = new URLSearchParams({ marketplaceIds: cfg.marketplaceId });
  if (keywords && keywords.trim()) qs.set("keywords", keywords.trim());

  const res = await spapiGet(`/definitions/2020-09-01/productTypes?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(
      `searchDefinitionsProductTypes failed (${res.status}): ${(await res.text()).slice(0, 300)}`
    );
  }
  const json = (await res.json()) as {
    productTypes?: { name: string; displayName?: string }[];
  };
  return (json.productTypes ?? []).map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
  }));
}

/**
 * Ask Amazon which product type an item belongs to, from its title.
 *
 * We need this because the Catalog Items API — the normal source of an ASIN's
 * productType — requires the Product Listing role, which this account doesn't
 * have, so every product comes back with productType: null. searchDefinitions-
 * ProductTypes accepts an `itemName` and returns Amazon's own suggestions, and
 * that endpoint works with the roles we do have.
 */
export async function inferProductType(itemName: string): Promise<ProductTypeSummary | null> {
  const cfg = getConfig();
  const qs = new URLSearchParams({
    marketplaceIds: cfg.marketplaceId,
    itemName: itemName.slice(0, 200),
  });

  const res = await spapiGet(`/definitions/2020-09-01/productTypes?${qs.toString()}`);
  if (!res.ok) return null;

  const json = (await res.json()) as {
    productTypes?: { name: string; displayName?: string }[];
  };
  const first = json.productTypes?.[0];
  return first ? { name: first.name, displayName: first.displayName || first.name } : null;
}

interface RawDefinition {
  schema?: { link?: { resource?: string } };
  propertyGroups?: Record<string, { title?: string; propertyNames?: string[] }>;
}

/**
 * getDefinitionsProductType, then follow the (presigned) link to the real schema.
 * Returns the normalized field list, cached in storage.
 */
export async function getProductTypeSchema(
  productType: string,
  force = false
): Promise<NormalizedSchema> {
  // Flat key: the local storage backend only creates the top-level .data dir,
  // so keys must not contain path separators.
  const key = `schema-${productType}.json`;

  if (!force) {
    const cached = await readJson<NormalizedSchema>(key);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < SCHEMA_TTL_MS) return cached;
  }

  const cfg = getConfig();
  const qs = new URLSearchParams({
    marketplaceIds: cfg.marketplaceId,
    requirements: "LISTING",
    locale: "en_US",
  });

  const res = await spapiGet(
    `/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}?${qs.toString()}`
  );
  if (!res.ok) {
    throw new Error(
      `getDefinitionsProductType failed (${res.status}): ${(await res.text()).slice(0, 300)}`
    );
  }
  const def = (await res.json()) as RawDefinition;

  const link = def.schema?.link?.resource;
  if (!link) throw new Error("Product type definition returned no schema link.");

  // The schema link is presigned — deliberately no auth header here.
  const schemaRes = await fetch(link, { cache: "no-store" });
  if (!schemaRes.ok) throw new Error(`Schema download failed (${schemaRes.status}).`);
  const schema = (await schemaRes.json()) as JsonSchema;

  const normalized = normalize(productType, schema, def.propertyGroups ?? {});
  await writeJson(key, normalized);
  return normalized;
}

// ─── Schema normalization ──────────────────────────────────────────────────

interface JsonSchemaProp {
  title?: string;
  description?: string;
  type?: string | string[];
  enum?: (string | number | boolean)[];
  enumNames?: string[];
  anyOf?: JsonSchemaProp[];
  oneOf?: JsonSchemaProp[];
  maxLength?: number;
  pattern?: string;
  examples?: unknown[];
  minItems?: number;
  maxItems?: number;
  /** Amazon caps some attributes with maxUniqueItems instead of maxItems. */
  minUniqueItems?: number;
  maxUniqueItems?: number;
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  hidden?: boolean;
  /** false = immutable after creation (NOT "unfillable"): brand, product_category. */
  editable?: boolean;
}

interface JsonSchema {
  required?: string[];
  properties?: Record<string, JsonSchemaProp>;
}

/** Child keys we understand and fill ourselves; anything else means "composite". */
const KNOWN_CHILDREN = new Set([
  "value",
  "unit",
  "language_tag",
  "marketplace_id",
  "media_location",
]);

export function normalize(
  productType: string,
  schema: JsonSchema,
  groupsDef: Record<string, { title?: string; propertyNames?: string[] }>
): NormalizedSchema {
  const requiredSet = new Set(schema.required ?? []);

  const groupOf = new Map<string, string>();
  for (const g of Object.values(groupsDef)) {
    const title = g.title ?? "Other";
    for (const n of g.propertyNames ?? []) groupOf.set(n, title);
  }

  const fields: FormField[] = [];
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.hidden) continue;
    fields.push(toField(name, prop, requiredSet.has(name), groupOf.get(name) ?? "Other"));
  }

  // Required first, then alphabetical — the required set is what people actually fill.
  fields.sort(
    (a, b) => Number(b.required) - Number(a.required) || a.title.localeCompare(b.title)
  );

  const groups = Array.from(new Set(fields.map((f) => f.group)));

  return {
    productType,
    fetchedAt: new Date().toISOString(),
    groups,
    fields,
    requiredCount: fields.filter((f) => f.required).length,
    unsupportedCount: fields.filter((f) => f.kind === "unsupported").length,
  };
}

function toField(
  name: string,
  prop: JsonSchemaProp,
  required: boolean,
  group: string
): FormField {
  const title = prop.title || humanize(name);
  const description = prop.description;

  const unsupported = (reason: string): FormField => ({
    name,
    title,
    description,
    group,
    required,
    kind: "unsupported",
    valueKey: "value",
    hasLanguageTag: false,
    hasMarketplaceId: false,
    reason,
  });

  // Amazon wraps virtually every attribute as an array of entry objects.
  const isArray = prop.type === "array";
  const item = isArray ? prop.items : prop;
  if (!item?.properties) return unsupported("Unrecognized schema shape.");

  const children = item.properties;
  const hasLanguageTag = "language_tag" in children;
  const hasMarketplaceId = "marketplace_id" in children;

  // Image locators hold the URL under `media_location` rather than `value`.
  const isImage = !children.value && !!children.media_location;
  const valueKey: "value" | "media_location" = isImage ? "media_location" : "value";
  const value = children[valueKey];

  if (value?.hidden) return unsupported("Hidden attribute.");
  if (!value) {
    return unsupported("Composite attribute (no single `value`) — set it in Vendor Central.");
  }

  // Anything with extra nested children (e.g. purchasable_offer's schedule,
  // item_dimensions' length/width/height) is out of scope for this form rather
  // than silently emitting a wrong payload.
  const extras = Object.keys(children).filter((k) => !KNOWN_CHILDREN.has(k));
  if (extras.length) {
    return unsupported(`Composite attribute (needs ${extras.join(", ")}) — set it in Vendor Central.`);
  }
  const vType = Array.isArray(value.type) ? value.type[0] : value.type;
  if (vType === "object" || vType === "array") {
    return unsupported("Nested value object — set it in Vendor Central.");
  }

  // Amazon uses maxItems on some attributes and maxUniqueItems on others
  // (bullet_point is maxUniqueItems: 10). Honor whichever is present.
  const cap = prop.maxItems ?? prop.maxUniqueItems ?? 1;
  const maxItems = isArray ? cap : 1;
  const minItems = isArray ? prop.minItems ?? prop.minUniqueItems : undefined;
  const examples = (value.examples ?? [])
    .filter((e): e is string => typeof e === "string")
    .slice(0, 2);

  const base = {
    name,
    title,
    description,
    group,
    required,
    valueKey,
    hasLanguageTag,
    hasMarketplaceId,
    maxItems,
    minItems,
    examples,
  };

  if (isImage) {
    return { ...base, kind: "image", maxItems: 1, pattern: value.pattern };
  }

  // Measurement: value + a unit enum.
  const unit = children.unit;
  if (unit && enumOf(unit).values.length) {
    return { ...base, kind: "measure", units: optionsFrom(unit) };
  }

  if (enumOf(value).values.length) {
    return { ...base, kind: "select", options: optionsFrom(value) };
  }

  if (vType === "boolean") return { ...base, kind: "boolean", maxItems: 1 };
  if (vType === "integer") return { ...base, kind: "integer" };
  if (vType === "number") return { ...base, kind: "number" };

  const maxLength = value.maxLength;
  const long = (maxLength ?? 0) > 250 || name === "bullet_point" || name.includes("description");
  return { ...base, kind: long ? "textarea" : "text", maxLength };
}

/**
 * Amazon declares most enums on the property itself, but ~50 of them hide the
 * enum inside an anyOf/oneOf branch (product_category, product_subcategory...).
 * Look in both places.
 */
function enumOf(p: JsonSchemaProp): { values: (string | number | boolean)[]; names: string[] } {
  if (p.enum?.length) return { values: p.enum, names: p.enumNames ?? [] };
  for (const branch of [...(p.anyOf ?? []), ...(p.oneOf ?? [])]) {
    if (branch?.enum?.length) return { values: branch.enum, names: branch.enumNames ?? [] };
  }
  return { values: [], names: [] };
}

function optionsFrom(p: JsonSchemaProp): FieldOption[] {
  const { values, names } = enumOf(p);
  return values.map((v, i) => ({ value: String(v), label: String(names[i] ?? v) }));
}

function humanize(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── Payload construction ──────────────────────────────────────────────────

/**
 * Turn flat form values into the exact `attributes` object the Listings Items
 * API expects. Getting this shape right now is what makes Phase 2 a one-call
 * change: PUT /listings/2021-08-01/items/{vendorCode}/{sku} with
 * { productType, requirements: "LISTING", attributes }.
 */
export function buildAttributes(
  fields: FormField[],
  values: Record<string, unknown>,
  marketplaceId: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const f of fields) {
    if (f.kind === "unsupported") continue;
    const raw = values[f.name];
    if (raw === undefined || raw === null || raw === "") continue;

    const list = Array.isArray(raw) ? raw : [raw];
    const entries: Record<string, unknown>[] = [];

    for (const v of list) {
      if (v === undefined || v === null || v === "") continue;
      const entry: Record<string, unknown> = {};
      const vk = f.valueKey;

      if (f.kind === "measure") {
        const m = v as { value?: unknown; unit?: unknown };
        if (m?.value === undefined || m.value === null || m.value === "") continue;
        entry[vk] = Number(m.value);
        if (m.unit) entry.unit = m.unit;
      } else if (f.kind === "boolean") {
        entry[vk] = v === true || v === "true";
      } else if (f.kind === "number" || f.kind === "integer") {
        entry[vk] = Number(v);
      } else if (f.kind === "image") {
        entry[vk] = String(v).trim();
      } else {
        entry[vk] = v;
      }

      if (f.hasLanguageTag) entry.language_tag = "en_US";
      if (f.hasMarketplaceId) entry.marketplace_id = marketplaceId;
      entries.push(entry);
    }

    if (entries.length) out[f.name] = entries;
  }

  return out;
}

/** Client-side validation from the schema's own rules. */
export function validateValues(
  fields: FormField[],
  values: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  for (const f of fields) {
    if (f.kind === "unsupported") continue;
    const raw = values[f.name];
    const list = (Array.isArray(raw) ? raw : [raw]).filter(
      (v) => v !== undefined && v !== null && v !== ""
    );

    if (f.required && list.length === 0) {
      errors.push(`${f.title} is required.`);
      continue;
    }
    if (list.length === 0) continue;

    if (f.maxItems && list.length > f.maxItems) {
      errors.push(`${f.title}: at most ${f.maxItems} value(s).`);
    }
    if (f.maxLength) {
      const over = list.some((v) => typeof v === "string" && v.length > f.maxLength!);
      if (over) errors.push(`${f.title}: exceeds ${f.maxLength} characters.`);
    }
    if (f.kind === "measure") {
      const bad = list.some((v) => {
        const m = v as { value?: unknown };
        return m?.value !== undefined && m.value !== "" && Number.isNaN(Number(m.value));
      });
      if (bad) errors.push(`${f.title}: value must be a number.`);
    }
    if (f.kind === "image" && f.pattern) {
      const re = new RegExp(f.pattern);
      const bad = list.some((v) => typeof v === "string" && !re.test(v.trim()));
      if (bad) errors.push(`${f.title}: must be a URL starting with http://, https:// or s3://.`);
    }
  }

  return errors;
}
