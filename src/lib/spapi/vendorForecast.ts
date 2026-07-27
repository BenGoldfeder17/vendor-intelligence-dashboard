// Pulls vendor forecast by reusing the most recent DONE GET_VENDOR_FORECASTING_REPORT.
// Keeps only forward-looking weeks within the configured horizon (bounds size), and
// when a week appears multiple times for an ASIN keeps the latest generation.

import { getConfig } from "./config";
import { getReportsData } from "./reports";
import type { ForecastPoint } from "../types";

interface ForecastRow {
  asin?: string;
  startDate?: string;
  endDate?: string;
  forecastGenerationDate?: string;
  meanForecastUnits?: number;
  p70ForecastUnits?: number;
  p80ForecastUnits?: number;
  p90ForecastUnits?: number;
}

interface ForecastReport {
  forecastByAsin?: ForecastRow[];
}

export async function fetchVendorForecast(
  onProgress?: (msg: string) => void
): Promise<Map<string, ForecastPoint[]>> {
  const cfg = getConfig();

  const docs = (await getReportsData(
    { reportType: "GET_VENDOR_FORECASTING_REPORT", reportOptions: { sellingProgram: cfg.sellingProgram } },
    1, // a single forecast report already spans many forward weeks
    onProgress
  )) as ForecastReport[];

  const horizon = horizonCutoff(cfg.forecastWeeks);
  const floor = pastCutoff();

  // key: asin|startDate -> row with the latest forecastGenerationDate wins
  const best = new Map<string, ForecastRow>();
  for (const doc of docs) {
    for (const r of doc?.forecastByAsin ?? []) {
      if (!r.asin) continue;
      const date = (r.startDate || r.endDate || "").slice(0, 10);
      if (!date || date < floor || date > horizon) continue;
      const key = `${r.asin}|${date}`;
      const ex = best.get(key);
      if (!ex || (r.forecastGenerationDate ?? "") > (ex.forecastGenerationDate ?? "")) best.set(key, r);
    }
  }

  const byAsin = new Map<string, ForecastPoint[]>();
  for (const r of best.values()) {
    const point: ForecastPoint = {
      date: (r.startDate || r.endDate || "").slice(0, 10),
      meanUnits: num(r.meanForecastUnits),
      p70Units: optNum(r.p70ForecastUnits),
      p80Units: optNum(r.p80ForecastUnits),
      p90Units: optNum(r.p90ForecastUnits),
    };
    const arr = byAsin.get(r.asin!) ?? [];
    arr.push(point);
    byAsin.set(r.asin!, arr);
  }

  for (const arr of byAsin.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  onProgress?.(`Forecast: ${byAsin.size} ASIN(s) within ${cfg.forecastWeeks} weeks.`);
  return byAsin;
}

function horizonCutoff(weeks: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
function pastCutoff(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 7); // include the current in-progress week
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function optNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
