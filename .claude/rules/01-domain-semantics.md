# Domain semantics — meanings that are easy to get wrong

## Net PPM vs gross PPM

- **Gross PPM** = `(shippedRevenue − shippedCogs) / shippedRevenue`. Derived from
  the vendor sales report. This is what `crap.ts` computes.
- **Net PPM** = the marketplace's own margin, which additionally folds in vendor
  terms and subtracts sales discounts. Reported via Data Kiosk / ARA.
- **Corrected Net PPM** = `grossPPM + totalAllowancePct` using the *real*
  contracted allowances from `app.config.ts` § 5b.

The marketplace's published Net PPM uses an **estimated** contra-COGS. Because
the real contracted percentages are known, the corrected figure is *more*
accurate than the marketplace's own. Never describe the marketplace's number as
authoritative.

## Contracts differ per vendor code

**Never compare every vendor code against one floor.** Terms are negotiated per
code. With a single global floor, a code at 31% under a 30% contract shows RED
while a code at 34% under a 36% contract shows GREEN — both exactly backwards.

- Per-code terms: `app.config.ts` § 5b, resolved via `contractFor(vendorCode)`.
- Portfolio comparison uses a **revenue-weighted blended floor**, not one number.

## Suppression codes are vendor-specific and dangerous to guess

`SUPPRESSION_CODES` maps letters to `margin | operational | not_suppressed`.

The failure that already happened: a code meaning **"send inventory"** (i.e. the
item is live and healthy) was classified as an unknown-reason suppression. That
inflated the suppression ledger by ~7,800 styles and ~$344K of phantom
"suppressed revenue".

Rule: **never infer a code's meaning from its letter.** If a legend is not
supplied, classify as `unknown` and say so in the UI. Do not guess.

## PO buckets are WEEKLY despite the naming

`vendorOrderStatus.weekStart()` returns the **Monday of the ISO week** as
`YYYY-MM-DD`. Variables are named `monthly` / `allMonths` / `windowMonths` for
historical reasons — they hold weeks. A "helpful" weeks→months conversion was
added once and silently shrank the PO window from 13 weeks to 3.

Sales periods are also weekly (`SALES_PERIOD=WEEK`), so PO and sales share a
grain and join 1:1. Do not add a conversion.

## Sourcing vs Manufacturing view

`SPAPI_DISTRIBUTOR_VIEW` selects which units are visible. Sourcing = units sourced
through your own vendor codes. Manufacturing = everything you make, whoever
sourced it. **They do not reconcile.** If product reaches the marketplace via a
distributor's vendor code, Sourcing view cannot see it — a real gap in the
denominator, not a bug.

## Report retention caps history

The marketplace retains only ~12 recent weekly reports. Raising `SALES_MAX_REPORTS`
alone cannot exceed what exists. `getReportsData(..., minWeeksWanted)` therefore
creates a **fresh full-window report** when reuse is sparse — slower once, but it
is the only way to get the full history.
