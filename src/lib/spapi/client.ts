// Thin HTTP client for SP-API: injects the LWA access token, handles JSON,
// and retries on throttling (429) and transient 5xx with exponential backoff.

import { getAccessToken } from "./auth";
import { getConfig } from "./config";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Path relative to the SP-API endpoint, e.g. "/catalog/2022-04-01/items". */
  path: string;
  query?: Record<string, string | number | string[] | undefined>;
  body?: unknown;
  /** Max retries on 429/5xx (default 4). */
  retries?: number;
}

export class SpapiError extends Error {
  status: number;
  details: string;
  constructor(message: string, status: number, details: string) {
    super(message);
    this.name = "SpapiError";
    this.status = status;
    this.details = details;
  }
}

export async function request<T = unknown>(opts: RequestOptions): Promise<T> {
  const cfg = getConfig();
  const url = new URL(cfg.endpoint + opts.path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) url.searchParams.set(k, v.join(","));
      else url.searchParams.set(k, String(v));
    }
  }

  const maxRetries = opts.retries ?? 4;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const token = await getAccessToken();
    const res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        "x-amz-access-token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });

    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      if (attempt < maxRetries) {
        const wait = backoffMs(attempt, res.headers.get("retry-after"));
        await sleep(wait);
        attempt++;
        continue;
      }
    }

    const text = await res.text();
    if (!res.ok) {
      throw new SpapiError(
        `SP-API ${opts.method ?? "GET"} ${opts.path} failed (${res.status})`,
        res.status,
        truncate(text)
      );
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SpapiError(
        `SP-API ${opts.path} returned non-JSON body`,
        res.status,
        truncate(text)
      );
    }
  }
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs)) return secs * 1000;
  }
  // 1s, 2s, 4s, 8s … with jitter
  return Math.min(8000, 2 ** attempt * 1000) + Math.floor(Math.random() * 400);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(s: string, n = 500): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
