// Login with Amazon (LWA) token exchange. SP-API (post-2023) authenticates with
// only the LWA access token in the `x-amz-access-token` header — no AWS SigV4 or
// role assumption required. We cache the access token until shortly before expiry.

import { getConfig } from "./config";

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let cache: TokenCache | null = null;
let inFlight: Promise<string> | null = null;

/** Returns a valid LWA access token, refreshing it when needed. */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt - 60_000 > now) return cache.accessToken;
  if (inFlight) return inFlight;

  inFlight = refresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function refresh(): Promise<string> {
  const cfg = getConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: cfg.refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const res = await fetch(cfg.lwaEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `LWA token exchange failed (${res.status}). ` +
        `Check LWA_CLIENT_ID / LWA_CLIENT_SECRET / LWA_REFRESH_TOKEN. Response: ${truncate(text)}`
    );
  }

  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`LWA token response was not JSON: ${truncate(text)}`);
  }
  if (!json.access_token) throw new Error("LWA token response missing access_token");

  cache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cache.accessToken;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
