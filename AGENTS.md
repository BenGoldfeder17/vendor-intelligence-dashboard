# AGENTS.md — Vendor Intelligence Dashboard

Agent suite for maintaining and upgrading this project. Structure follows ECC
conventions so it is readable by Claude Code, Cursor, Codex and OpenCode from one
source of truth.

```
.claude/
  agents/     12 scoped subagents — delegate by domain
  rules/      always-follow invariants (read these first)
  skills/     workflow procedures
AGENTS.md     this index
```

---

## What this project is

A **marketplace vendor analytics dashboard** (Next.js 15 / React 19 / TypeScript).
It pulls Amazon SP-API vendor data, detects silent margin erosion ("CRaP-out"),
tracks self-suppression cost, and surfaces everything as one ranked triage feed.

It is **white-labelled and portable**: no company name in the codebase, all
tenant-specific values in `src/config/app.config.ts`, and it deploys to any host
(local disk / S3 / GCS storage drivers).

**Read `.claude/rules/` before touching anything.** They encode failures this
project has already had — every rule exists because something broke.

---

## Agent routing

| Agent | Delegate when the work touches |
|---|---|
| `architect` | Module boundaries, where new code belongs, cross-cutting changes, big refactors |
| `security-auditor` | Auth, secrets, the read-only SQL guard, IAM, dependencies, anything writing data |
| `config-portability` | `app.config.ts`, `.env`, storage drivers, deployment to any platform |
| `marketplace-api` | SP-API client, reports, Data Kiosk, Listings Items, rate limits, roles |
| `margin-analytics` | `crap.ts`, `riskMonitor.ts`, contracts, thresholds, Net PPM, suppression codes |
| `data-warehouse` | BigQuery layer, snapshots, table/column mapping, the read-only query path |
| `sync-pipeline` | `sync.ts`, aggregate build, report cache, storage, performance |
| `frontend-ui` | Components, domain hubs, triage UI, styling, DirectLake-free rendering |
| `build-release` | Build failures, dependencies, Next/webpack config, Dockerfile, CI, packaging, releases |
| `verification` | Proving a change works: unit checks, invariant sweeps, evidence before claims |
| `data-integrity` | Column semantics, parser correctness, "is this number actually right?" |
| `agent-maintainer` | Keeping this suite accurate — after renames, new features, new failure classes, or adding an agent |

**Default flow for a non-trivial change:**
`architect` (where does this go?) → domain agent (build it) → `build-release`
(does it compile and package?) → `security-auditor` (if it touches
data/secrets/writes) → `verification` (prove the behaviour).

**Anything that fails to compile goes to `build-release` first** — the failure is
usually a known pipeline issue, not a logic bug. It keeps a catalogue of every
build failure this repo has actually had.

**If a change makes anything in `.claude/` untrue, finish with `agent-maintainer`.**
An agent pointing at a renamed file is worse than no agent — it sends work down a
dead path with false confidence.

```bash
node scripts/verify-agents.cjs     # every agent claim, checked against the code
```

---

## Non-negotiables (full text in `.claude/rules/`)

0. **Never read `env.yaml`.** It holds credentials and contract terms. Use
   `env.example.yaml` for structure and `/api/health` for state.
   See `.claude/rules/02-secrets-and-env.md`.
1. **SQL that changes anything must be labelled in bold, up front.** Never alter a
   table the operator did not create without explicit permission.
2. **`src/config/app.config.ts` is the only file that reads `process.env`.**
3. **Never claim something exists without opening the file.** This project has
   already shipped a comment referencing a hook that was never built.
4. **Verify by running.** A change is not done because it compiles — it is done
   when its behaviour is demonstrated.
5. **Deliver complete, runnable files** — never diffs, fragments or partial patches.

---

## Quick facts an agent needs

- Build: `npm run build` (Next.js standalone). Type errors fail the build.
- Config: `src/config/app.config.ts` → everything alterable. `.env.example` documents it.
- Health check: `GET /api/health` reports config + storage + warehouse state.
- Storage: `STORAGE_DRIVER=local|s3|gcs`. Cloud SDKs are dynamically imported.
- Pages: `/` (triage), `/risk`, `/sales`, `/listings`, `/product/[asin]`.
- The warehouse layer is **optional** — margin panels work without it.
