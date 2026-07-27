# Vendor Intelligence Dashboard

Marketplace vendor analytics for Amazon 1P vendors. Detects **silent margin
erosion** — the case where the marketplace quietly stops buying an item because
its margin fell, which generates no rejection to notice — tracks the cost of
your own suppression policy, and surfaces everything as one ranked triage feed.

**Next.js 15 · React 19 · TypeScript.** White-labelled and portable: no company
name in the codebase, all custom values in one config file, deployable to any
host.

---

## The problem it solves

A marketplace PO engine is margin-filtered. When an item's margin drops, the
marketplace reduces order quantities or stops buying it — producing **no PO line
to classify**. It is silence, not a rejection.

Consequences most vendor tooling misses:

- Lane classifiers over arriving POs cannot see a CRaP-out, because nothing arrives.
- PO volume is demand *after* the margin screen, so treating it as demand reads a
  filtered series.
- "The marketplace stopped ordering because we suppressed it" and "…because we
  stopped being worth ordering" look identical and call for opposite responses.

This separates them.

---

## Quick start

```bash
cp env.example.yaml env.yaml
./scripts/local.sh                    # → http://localhost:3000
```

Runs with **no credentials** — the UI works and every panel explains what it
needs instead of crashing or showing a fake zero. See **[LOCAL.md](LOCAL.md)**.

---

## What it does

**Triage (`/`)** — every actionable signal across all three domains, ranked by
revenue impact. Reads the domain modules rather than recomputing, so a signal can
never disagree with the page it links to.

**Revenue risk (`/risk`)**
- Silent-CRaP detector: margin below benchmark **+** PO velocity decayed **+** no
  suppression of your own
- Net PPM floor gauge, revenue-weighted, against **per-vendor-code** contracts
- Vendor-code concentration — weakest contract headroom first
- Suppression ledger: what your own policy costs, split margin vs operational
- Fill risk and a data-quality strip

**Sales (`/sales`)** — overview, drags & drivers, forecast

**Listings (`/listings`)** — catalog, schema-driven product submission

---

## Design decisions worth knowing

**Contracts are per vendor code.** A single global margin floor mis-ranks codes
whenever terms differ: a code at 31% under a 30% contract is healthy while one at
34% under a 36% contract is underwater. One floor shows both backwards.

**Corrected Net PPM.** The marketplace publishes a Net PPM built on an *estimated*
contra-COGS. Given your real contracted allowances, the figure computed here is
more accurate than the one the marketplace shows you.

**Blocked panels stay visibly blocked.** Where data does not exist, the UI says
so rather than rendering an empty table or a fabricated zero.

**Storage is key→JSON with three drivers** (local disk, S3-compatible, GCS), so
the same build runs on a laptop, a VM, or serverless.

---

## Documentation

| File | Covers |
|---|---|
| [LOCAL.md](LOCAL.md) | Running locally, troubleshooting |
| [DEPLOY.md](DEPLOY.md) | Docker, SSH/systemd, AWS, GCP, Kubernetes |
| [SECURITY.md](SECURITY.md) | Auth model, secrets, reporting |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Conventions and invariants |
| [AGENTS.md](AGENTS.md) | Agent suite for maintaining the project |
| `env.example.yaml` | Every configurable value, documented |

---

## Configuration

`env.yaml` is the single custom-configuration file, mapped by
`src/config/app.config.ts` — the only file in the codebase that reads the
environment.

```bash
npm run validate                 # catch config errors before a deploy does
curl -s localhost:3000/api/health
```

> **Quote every value in `env.yaml`.** YAML 1.1 turns bare `y/Y/n/N/yes/no/on/off`
> into booleans and bare digits into numbers; a deploy then fails with an error
> that does not name the key. The validator catches it.

---

## Commands

```bash
npm run local       # setup + dev server
npm run validate    # validate env.yaml
npm run build       # production build
npm start           # serve the build
npm run typecheck   # tsc --noEmit
./scripts/deploy.sh # deploy per DEPLOY_PLATFORM
```

---

## Two things to know before deploying

**No built-in authentication.** The app exposes margin data and can submit
listings. Put it behind an identity-aware proxy, VPN, or auth layer.
See [SECURITY.md](SECURITY.md).

**The weekly snapshot cannot be backfilled.** Suppression flags and replenishment
codes are current-state-only and overwrite on refresh. Every week the job does
not run is history gone permanently. Schedule it first.

---

## Requirements

- Node 20+ (22 recommended)
- Amazon SP-API credentials with **Brand Analytics** for margin data; **Product
  Listing** additionally required for catalog attributes and live submission
- Optional: BigQuery for the suppression ledger and fill-risk panels

---

## Licence

**[PolyForm Noncommercial License 1.0.0](LICENSE)** — source-available, free for
noncommercial use.

Free for personal projects, study, academic institutions, nonprofits and
government. **Commercial use requires a licence** — see [COMMERCIAL.md](COMMERCIAL.md).

Deliberately *not* an OSI-approved open-source licence: it restricts a field of
endeavour (commercial use), which the open-source definition does not permit.
The source is public and readable; the commercial grant is not automatic.
