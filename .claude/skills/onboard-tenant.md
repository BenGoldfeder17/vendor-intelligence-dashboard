# Onboarding a new tenant

Owner: **`config-portability`**, with **`margin-analytics`** for steps 3–4.

1. `cp .env.example .env`; set the three marketplace credentials.
2. Identity: `APP_MARK`, `APP_NAME`, `ORG_NAME`, brand labels, `OWN_BRAND_MATCHERS`.
3. **Real suppression-code legend** → `SUPPRESSION_CODES`. Never guess a letter.
4. **Per-vendor-code contracts** → `app.config.ts` §5b. Without them, one floor
   is applied to every code and the ranking is wrong wherever terms differ.
5. Storage driver + durability check for that host.
6. Warehouse table/column mapping if enabled.
7. `curl /api/health` → resolve every hint.
8. Schedule the weekly snapshot **immediately** — it cannot be backfilled.
