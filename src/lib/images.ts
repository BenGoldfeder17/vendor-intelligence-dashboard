// Amazon's public per-ASIN image endpoint. Requires no authentication and works
// for any real, listed ASIN — used as the image source when the authenticated
// Catalog Items API (which needs the Product Listing role) is unavailable.
//
// Pattern: https://m.media-amazon.com/images/P/{ASIN}.01._SL{size}_.jpg
// Note: nonexistent ASINs return a gray placeholder (HTTP 200), so this is only
// reliable for ASINs known to exist — which ours are (they come from sales data).

export function publicAsinImage(asin: string, size = 500): string {
  return `https://m.media-amazon.com/images/P/${encodeURIComponent(asin)}.01._SL${size}_.jpg`;
}
