// ARA Net PPM export parser + store.
//
// This is a DIFFERENT file from the reference CSV: it's Amazon's ARA Net PPM
// report, which carries Brand Code, Net PPM, a prior-period figure, and shipped
// revenue at ASIN grain. Powers Panels 1-3 and 6. Stored as its own JSON doc so
// it can be refreshed independently of the reference / suppression CSVs.
//
// Column names in ARA exports drift, so headers are matched by alias and parsing
// degrades (nulls) rather than throwing when a column is absent.

import { readJson, writeJson, deleteJson } from "./storage";
import type { NetPpmRow } from "./riskMonitor";

const KEY = "ara-net-ppm.json";

export interface AraNetPpmData {
  meta: {
    uploadedAt: string;
    rowCount: number;
    detectedColumns: Record<string, string | null>;
  };
  rows: NetPpmRow[];
}

const ALIASES: Record<string, string[]> = {
  asin: ["asin", "asin id", "child asin"],
  brandCode: ["brand code", "brandcode", "vendor code", "brand", "vendor"],
  netPpm: ["net ppm %", "net ppm", "net pure product margin", "net_ppm", "net margin", "ppm"],
  // ARA gives the prior period as an ABSOLUTE value in basis points
  // ("Net PPM % - Prior Period (bps)"), e.g. 9559 = 95.59%. Not a delta.
  priorNetPpm: [
    "net ppm % - prior period (bps)",
    "net ppm % prior period (bps)",
    "prior period (bps)",
    "prior net ppm",
    "net ppm prior",
    "prior ppm",
  ],
  shippedRevenue: [
    "shipped revenue",
    "shipped_revenue",
    "shipped cogs revenue",
    "ordered revenue",
    "revenue",
    "shipped rev",
  ],
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function matchColumn(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[_\s]+/g, " "));
  for (const a of aliases) {
    const i = norm.indexOf(a);
    if (i >= 0) return i;
  }
  // loose contains-match as a fallback
  for (let i = 0; i < norm.length; i++) {
    if (aliases.some((a) => norm[i].includes(a))) return i;
  }
  return -1;
}

/** Parse a percentage or number cell to a fraction. "36.07%" → 0.3607; "0.36" → 0.36. */
function toFraction(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  const isPct = t.includes("%");
  const n = Number(t.replace(/[%,$\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  // A bare number > 1.5 is almost certainly a percent written without the sign.
  if (isPct || Math.abs(n) > 1.5) return n / 100;
  return n;
}

/** Basis points → fraction. "9559" → 0.9559; "-203" → -0.0203. */
function bpsToFraction(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.replace(/[,\s%]/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n / 10000 : null;
}

function toNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export interface AraParseResult {
  rows: NetPpmRow[];
  detectedColumns: Record<string, string | null>;
  errors: string[];
}

export function parseAraNetPpmCsv(text: string): AraParseResult {
  const allLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];

  // ARA exports prepend a metadata line (Distributor View=[...], Reporting Range=[...]).
  // The real header row is the first one whose first cell is the ASIN column.
  const headerIdx = allLines.findIndex((l) => {
    const first = splitCsvLine(l)[0]?.trim().toLowerCase();
    return first === "asin" || first === "asin id";
  });
  const lines = headerIdx >= 0 ? allLines.slice(headerIdx) : allLines;
  if (lines.length < 2) {
    return { rows: [], detectedColumns: {}, errors: ["No data rows found under the header."] };
  }

  const headers = splitCsvLine(lines[0]);
  const idx = {
    asin: matchColumn(headers, ALIASES.asin),
    brandCode: matchColumn(headers, ALIASES.brandCode),
    netPpm: matchColumn(headers, ALIASES.netPpm),
    priorNetPpm: matchColumn(headers, ALIASES.priorNetPpm),
    shippedRevenue: matchColumn(headers, ALIASES.shippedRevenue),
  };

  const detectedColumns: Record<string, string | null> = {
    asin: idx.asin >= 0 ? headers[idx.asin] : null,
    brandCode: idx.brandCode >= 0 ? headers[idx.brandCode] : null,
    netPpm: idx.netPpm >= 0 ? headers[idx.netPpm] : null,
    priorNetPpm: idx.priorNetPpm >= 0 ? headers[idx.priorNetPpm] : null,
    shippedRevenue: idx.shippedRevenue >= 0 ? headers[idx.shippedRevenue] : null,
  };

  if (idx.asin < 0) errors.push("No ASIN column found — rows can't be keyed.");
  if (idx.netPpm < 0) errors.push("No Net PPM column found — Panels 1-3 will be empty.");
  // Sourcing Net PPM exports carry no revenue column; we join shipped revenue
  // from the synced aggregate by ASIN, so this is informational, not fatal.
  if (idx.shippedRevenue < 0)
    errors.push("No revenue column in this export — weighting by synced shipped revenue instead.");

  const rows: NetPpmRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const asin = idx.asin >= 0 ? c[idx.asin]?.trim() : "";
    if (!asin) continue;
    rows.push({
      asin,
      brandCode: idx.brandCode >= 0 ? c[idx.brandCode]?.trim() || null : null,
      netPpm: idx.netPpm >= 0 ? toFraction(c[idx.netPpm]) : null,
      priorNetPpm: idx.priorNetPpm >= 0 ? bpsToFraction(c[idx.priorNetPpm]) : null,
      shippedRevenue: idx.shippedRevenue >= 0 ? toNum(c[idx.shippedRevenue]) : null,
    });
  }

  return { rows, detectedColumns, errors };
}

export async function readAraNetPpm(): Promise<AraNetPpmData | null> {
  return readJson<AraNetPpmData>(KEY);
}

export async function writeAraNetPpm(data: AraNetPpmData): Promise<void> {
  await writeJson(KEY, data);
}

export async function deleteAraNetPpm(): Promise<void> {
  await deleteJson(KEY);
}
