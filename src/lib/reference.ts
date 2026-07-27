// Reference layer: Ben's price/inventory export joined to PO data on ASIN.
// Columns expected (header names are matched flexibly, case-insensitive):
//   ASIN, Style, Brand, Code (cancellation code), on-hand quantity
//
// Code semantics: anything other than "N" (or blank) is a cancellation code.
// N  (no-cancel / in stock)
// M Margin · V Vendor Prohibits · F MOI/Factor · H Hazmat · I Inventory Control ·
// Q Quality Control · W Warehouse Impact · Y Catch-All · S Seasonality ·
// P NetPPM · D Discontinued
//
// Persistence goes through ./storage (GCS on Cloud Run, local .data/ in dev).

import { readJson, writeJson, deleteJson } from "./storage";

const REF_KEY = "reference.json";

export const CODE_LABELS: Record<string, string> = {
  N: "In stock / confirm",
  M: "Margin",
  V: "Vendor Prohibits",
  F: "MOI/Factor",
  H: "Hazmat",
  I: "Inventory Control",
  Q: "Quality Control",
  W: "Warehouse Impact",
  Y: "Catch-All",
  S: "Seasonality",
  P: "NetPPM",
  D: "Discontinued",
};

export interface ReferenceRow {
  asin: string;
  style: string | null;
  /** Raw brand string from the file (resolved/inferred at report time). */
  brand: string | null;
  /** Raw cancellation code (single letter), uppercased. */
  code: string | null;
  onHand: number;
  /** Optional: our own advertised price on the DTC storefront. */
  webPrice: number | null;
  /**
   * Optional: units covered by webPrice. A "per dozen" web price against a
   * "per pair" ASIN produces a garbage 12x signal, so this normalizes it.
   */
  packSize: number | null;
}

export interface ReferenceMeta {
  uploadedAt: string;
  rowCount: number;
  hadBrandColumn: boolean;
  detectedColumns: Record<string, string | null>;
}

export interface ReferenceData {
  meta: ReferenceMeta;
  rows: ReferenceRow[];
}

/**
 * A cell may carry multiple codes (e.g. "M N V"). Returns the individual
 * cancelling codes — every token except N (which means "in stock / confirm").
 */
export function cancelCodes(code: string | null | undefined): string[] {
  return (code ?? "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t && t !== "N");
}

/** True if the cell carries any cancelling code (anything other than solely N). */
export function isCancelCode(code: string | null | undefined): boolean {
  return cancelCodes(code).length > 0;
}

export async function readReference(): Promise<ReferenceData | null> {
  return readJson<ReferenceData>(REF_KEY);
}

export async function writeReference(data: ReferenceData): Promise<void> {
  await writeJson(REF_KEY, data);
}

export async function deleteReference(): Promise<void> {
  await deleteJson(REF_KEY);
}

// ─── CSV parsing ───────────────────────────────────────────────────────────

/** Parse a single CSV line honoring double-quote escaping. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADER_ALIASES: Record<keyof Omit<ReferenceRow, never>, string[]> = {
  asin: ["asin", "amazon asin", "asin number"],
  style: ["style", "style10", "style 10", "style#", "style #", "style number", "model"],
  brand: ["brand", "brand flag", "brand name", "manufacturer"],
  code: ["code", "cancellation code", "cancel code", "reason code", "cancel reason", "po code"],
  onHand: ["ecomm on hand", "ecomm onhand", "on hand", "onhand", "on-hand", "ecomm_on_hand", "qty on hand", "available", "inventory"],
  webPrice: ["web price", "webprice", "dtc price", "site price", "list price", "advertised price"],
  packSize: ["pack size", "packsize", "units per pack", "uom qty", "pack qty", "case qty", "units"],
};

function matchColumn(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/[_\s]+/g, " ").trim());
  for (const a of aliases) {
    const idx = norm.indexOf(a);
    if (idx >= 0) return idx;
  }
  // loose contains match
  for (let i = 0; i < norm.length; i++) {
    if (aliases.some((a) => norm[i].includes(a) || a.includes(norm[i]))) return i;
  }
  return -1;
}

export interface ParseResult {
  rows: ReferenceRow[];
  hadBrandColumn: boolean;
  detectedColumns: Record<string, string | null>;
  errors: string[];
}

export function parseReferenceCsv(text: string): ParseResult {
  const errors: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], hadBrandColumn: false, detectedColumns: {}, errors: ["Empty file."] };

  const headers = parseCsvLine(lines[0]);
  const idx = {
    asin: matchColumn(headers, HEADER_ALIASES.asin),
    style: matchColumn(headers, HEADER_ALIASES.style),
    brand: matchColumn(headers, HEADER_ALIASES.brand),
    code: matchColumn(headers, HEADER_ALIASES.code),
    onHand: matchColumn(headers, HEADER_ALIASES.onHand),
    webPrice: matchColumn(headers, HEADER_ALIASES.webPrice),
    packSize: matchColumn(headers, HEADER_ALIASES.packSize),
  };
  const detectedColumns: Record<string, string | null> = {
    asin: idx.asin >= 0 ? headers[idx.asin] : null,
    style: idx.style >= 0 ? headers[idx.style] : null,
    brand: idx.brand >= 0 ? headers[idx.brand] : null,
    code: idx.code >= 0 ? headers[idx.code] : null,
    onHand: idx.onHand >= 0 ? headers[idx.onHand] : null,
    webPrice: idx.webPrice >= 0 ? headers[idx.webPrice] : null,
    packSize: idx.packSize >= 0 ? headers[idx.packSize] : null,
  };
  if (idx.asin < 0) errors.push("Could not find an ASIN column.");

  const rows: ReferenceRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const asin = (idx.asin >= 0 ? c[idx.asin] : "")?.trim();
    if (!asin) continue;
    if (seen.has(asin)) continue; // keep first occurrence
    seen.add(asin);
    rows.push({
      asin,
      style: idx.style >= 0 ? c[idx.style]?.trim() || null : null,
      brand: idx.brand >= 0 ? c[idx.brand]?.trim() || null : null,
      code: idx.code >= 0 ? c[idx.code]?.trim().toUpperCase() || null : null,
      onHand: idx.onHand >= 0 ? toNum(c[idx.onHand]) : 0,
      webPrice: idx.webPrice >= 0 ? toNum(c[idx.webPrice]) || null : null,
      packSize: idx.packSize >= 0 ? toNum(c[idx.packSize]) || null : null,
    });
  }

  return { rows, hadBrandColumn: idx.brand >= 0, detectedColumns, errors };
}

function toNum(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
