// Listings Items API (2021-08-01) — the actual "push a product to Amazon" call.
//
// This closes the loop the submission page was built around: the form assembles
// the exact { productType, requirements: "LISTING", attributes } body, and this
// PUTs it to Amazon rather than only exporting it. Individual submission (one SKU
// at a time); the bulk JSON_LISTINGS_FEED path is a separate module.
//
// REQUIREMENTS, and why a submit can still fail after all our work:
//   • The SP-API app must hold the Product Listing role. Without it this 403s —
//     the same gap that leaves productType null on the catalog side.
//   • SPAPI_SELLER_ID (vendor/seller id) must be set — it's in the request path.
// Both are surfaced as clear, actionable errors rather than a raw 400.

import { request, SpapiError } from "./client";
import { getConfig } from "./config";

const LISTINGS_BASE = "/listings/2021-08-01";

export interface ListingSubmitResult {
  ok: boolean;
  status: "ACCEPTED" | "INVALID" | "VALID" | "UNKNOWN";
  submissionId?: string;
  /** Amazon's per-attribute issues, if any — surfaced verbatim to the user. */
  issues: {
    code: string;
    message: string;
    severity: string;
    attributeName?: string;
  }[];
  /** Human-readable reason when we blocked the call before it left. */
  blocked?: string;
}

interface PutListingsResponse {
  sku?: string;
  status?: string;
  submissionId?: string;
  issues?: {
    code: string;
    message: string;
    severity: string;
    attributeNames?: string[];
  }[];
}

/**
 * Submit (create or fully replace) a single listing.
 *
 * @param sku          your SKU / style code — the listing's key
 * @param productType  e.g. PROTECTIVE_GLOVE
 * @param attributes   the same attributes object the form's payload preview shows
 * @param issueLocale  locale for issue messages (default en_US)
 */
export async function putListingsItem(
  sku: string,
  productType: string,
  attributes: Record<string, unknown>,
  issueLocale = "en_US"
): Promise<ListingSubmitResult> {
  const cfg = getConfig();

  if (!cfg.sellerId) {
    return {
      ok: false,
      status: "UNKNOWN",
      issues: [],
      blocked:
        "SPAPI_SELLER_ID isn't set. Add your vendor/seller id to env.yaml — it's required in the Listings Items path.",
    };
  }
  if (!sku.trim()) {
    return { ok: false, status: "UNKNOWN", issues: [], blocked: "A SKU is required." };
  }

  const body = {
    productType,
    requirements: "LISTING",
    attributes,
  };

  try {
    const res = await request<PutListingsResponse>({
      method: "PUT",
      path: `${LISTINGS_BASE}/items/${encodeURIComponent(cfg.sellerId)}/${encodeURIComponent(
        sku.trim()
      )}`,
      query: {
        marketplaceIds: cfg.marketplaceId,
        issueLocale,
      },
      body,
    });

    const issues = (res.issues ?? []).map((i) => ({
      code: i.code,
      message: i.message,
      severity: i.severity,
      attributeName: i.attributeNames?.[0],
    }));

    const status = (res.status as ListingSubmitResult["status"]) ?? "UNKNOWN";
    // ACCEPTED = queued; VALID = passed validation. Either is a successful submit.
    const ok = status === "ACCEPTED" || status === "VALID";

    return { ok, status, submissionId: res.submissionId, issues };
  } catch (e) {
    if (e instanceof SpapiError && e.status === 403) {
      return {
        ok: false,
        status: "UNKNOWN",
        issues: [],
        blocked:
          "Amazon returned 403 — your SP-API app lacks the Product Listing role. Add it and re-authorize, then submissions will go through.",
      };
    }
    if (e instanceof SpapiError && e.status === 400) {
      // A 400 usually carries structured issues in the body; surface them.
      let issues: ListingSubmitResult["issues"] = [];
      try {
        const parsed = JSON.parse(e.details) as PutListingsResponse;
        issues = (parsed.issues ?? []).map((i) => ({
          code: i.code,
          message: i.message,
          severity: i.severity,
          attributeName: i.attributeNames?.[0],
        }));
      } catch {
        /* fall through to blocked message */
      }
      return {
        ok: false,
        status: "INVALID",
        issues,
        blocked: issues.length ? undefined : `Amazon rejected the listing: ${e.details.slice(0, 300)}`,
      };
    }
    throw e;
  }
}

/** Read back a listing's current status (used to confirm a submission landed). */
export async function getListingsItem(sku: string): Promise<PutListingsResponse | null> {
  const cfg = getConfig();
  if (!cfg.sellerId) return null;
  try {
    return await request<PutListingsResponse>({
      path: `${LISTINGS_BASE}/items/${encodeURIComponent(cfg.sellerId)}/${encodeURIComponent(sku)}`,
      query: { marketplaceIds: cfg.marketplaceId, includedData: "issues,summaries" },
    });
  } catch (e) {
    if (e instanceof SpapiError && e.status === 404) return null;
    throw e;
  }
}
