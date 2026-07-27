import { NextResponse } from "next/server";
import { readAggregate } from "@/lib/cache";
import { getProductTypeSchema, inferProductType, type FormField } from "@/lib/productTypes";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_VARIANT: Record<string, string> = {
  main_product_image_locator: "MAIN",
  other_product_image_locator_1: "PT01",
  other_product_image_locator_2: "PT02",
  other_product_image_locator_3: "PT03",
  other_product_image_locator_4: "PT04",
  other_product_image_locator_5: "PT05",
  other_product_image_locator_6: "PT06",
  other_product_image_locator_7: "PT07",
  other_product_image_locator_8: "PT08",
  swatch_product_image_locator: "SWCH",
};

/** Identity fields that must never be copied onto a new product. */
const NEVER_COPY = new Set([
  "external_product_id",
  "externally_assigned_product_identifier",
  "merchant_suggested_asin",
  "item_sku",
]);

function prefill(
  product: Product,
  fields: FormField[]
): { values: Record<string, unknown>; filled: number; hadAttributes: boolean } {
  const attrs = (product.attributes ?? {}) as Record<string, unknown>;
  const hadAttributes = Object.keys(attrs).length > 0;
  const imageByVariant = new Map(product.images.map((i) => [i.variant, i.link]));
  const out: Record<string, unknown> = {};

  /**
   * The Catalog Items API only returns full `attributes` to the brand owner, so
   * for third-party brands it can come back empty. The summary fields (title,
   * brand, bullets, description, images) are always there — use them as the
   * floor so cloning never silently produces an empty form.
   */
  const fallback: Record<string, unknown> = {};
  if (product.title) fallback.item_name = product.title;
  if (product.brand) fallback.brand = product.brand;
  if (product.bullets?.length) fallback.bullet_point = product.bullets.slice(0, 10);
  if (product.description) fallback.product_description = product.description;

  for (const f of fields) {
    if (f.kind === "unsupported" || NEVER_COPY.has(f.name)) continue;

    if (f.kind === "image") {
      const variant = IMAGE_VARIANT[f.name];
      const link = variant ? imageByVariant.get(variant) : undefined;
      if (link) out[f.name] = link;
      continue;
    }

    const raw = attrs[f.name] ?? fallback[f.name];
    if (raw === undefined || raw === null || raw === "") continue;

    if (f.kind === "measure") {
      // The catalog cache flattens entries to their `value`, so the unit is lost.
      const n = Array.isArray(raw) ? raw[0] : raw;
      if (typeof n === "number" || typeof n === "string") out[f.name] = { value: n };
      continue;
    }

    if (f.kind === "boolean") {
      out[f.name] = raw === true || raw === "true";
      continue;
    }

    // A select only accepts a value that's actually in its option list.
    if (f.kind === "select") {
      const v = Array.isArray(raw) ? raw[0] : raw;
      const str = String(v);
      if (f.options?.some((o) => o.value === str)) out[f.name] = str;
      continue;
    }

    out[f.name] =
      (f.maxItems ?? 1) > 1
        ? Array.isArray(raw)
          ? raw.map(String)
          : [String(raw)]
        : Array.isArray(raw)
          ? raw[0]
          : raw;
  }

  return { values: out, filled: Object.keys(out).length, hadAttributes };
}

/** GET /api/prefill?asin=B0... — clone an existing listing into form values. */
export async function GET(req: Request) {
  const asin = new URL(req.url).searchParams.get("asin");
  if (!asin) return NextResponse.json({ error: "asin is required." }, { status: 400 });

  const agg = await readAggregate();
  if (!agg) {
    return NextResponse.json({ error: "No catalog yet — run a sync first." }, { status: 404 });
  }
  const product = agg.products.find((p) => p.asin === asin);
  if (!product) return NextResponse.json({ error: `${asin} isn't in the catalog.` }, { status: 404 });

  try {
    // The Catalog Items API needs the Product Listing role, which this account
    // lacks — so productType is null on every product and `attributes` is empty.
    // Fall back to asking Amazon to infer the type from the item's title.
    let productType = product.productType;
    let inferred = false;

    if (!productType && product.title) {
      const guess = await inferProductType(product.title);
      if (guess) {
        productType = guess.name;
        inferred = true;
      }
    }

    if (!productType) {
      return NextResponse.json(
        {
          error:
            `Amazon didn't return a product type for ${asin}, and there's no title to infer one from. ` +
            `Pick a product type by hand and fill the form — cloning needs the Product Listing role to work properly.`,
        },
        { status: 422 }
      );
    }

    const schema = await getProductTypeSchema(productType);
    const { values, filled, hadAttributes } = prefill(product, schema.fields);

    return NextResponse.json({
      productType,
      inferred,
      values,
      filled,
      hadAttributes,
      source: { asin: product.asin, title: product.title, style: product.style10 ?? product.style },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
