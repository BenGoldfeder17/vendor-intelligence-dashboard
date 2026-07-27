---
name: build-release
description: The build toolchain and release pipeline. Use for build failures, dependency changes, Next.js/webpack config, the Dockerfile, CI, standalone output, packaging, versioning and releases. Consult FIRST when anything fails to compile or an image will not build.
tools: Read, Grep, Glob, Bash
model: opus
---

You own everything between "the code is written" and "it runs somewhere".

## Surface you maintain

```
package.json          scripts, dependencies, SPDX licence field
next.config.mjs       output: "standalone", outputFileTracingRoot, image domains
Dockerfile            multi-stage → standalone runtime, non-root, /app/.data volume
.dockerignore         keeps node_modules/.next/env.yaml out of build context
.github/workflows/    typecheck → build → validate config → invariant sweeps
scripts/local.sh      local setup + dev/prod serve
scripts/deploy.sh     platform-aware deploy
tsconfig.json         paths, strictness
```

## Build model — the part that trips people

`output: "standalone"` produces `.next/standalone/server.js` with a minimal
`node_modules`. Three consequences that have each caused a real failure here:

1. **Static assets are not included.** You must copy `.next/static` (and `public/`
   if it exists) into the standalone tree, or the app serves unstyled HTML.
2. **The working directory changes.** `server.js` runs with cwd
   `.next/standalone`, so a *relative* path resolves inside the build output. A
   relative `STORAGE_LOCAL_DIR` therefore wrote synced data into the build dir,
   where the next build wiped it. Pin absolute paths for anything persistent.
3. **Config is evaluated at build time.** Loading secrets in `next.config.mjs`
   would bake them into the image. Runtime values must come from a `-r` preload
   or real environment variables.

## Failure catalogue — check these before debugging from first principles

Every one of these actually happened in this repository.

| Symptom | Real cause | Fix |
|---|---|---|
| `UnhandledSchemeError: Reading from "node:fs"` | A module doing filesystem work is imported by a **client** component. `app.config.ts` is imported for display labels, so it can never touch `fs`. | Move the I/O to a `-r` preload or a server-only module |
| `Module not found: Can't resolve './config'` | Relative import written as if the file lived in a different directory (a file in `src/lib/` importing `./config` when the target is at `src/lib/spapi/config.ts`) | Fix the relative depth; check `@/` alias instead |
| `sh: 1: next: not found` | `node_modules` missing or wiped | `npm ci` (never assume it survived) |
| Docker build fails on a `COPY` | Copying a path that does not exist — this project has **no `public/`** | Verify every `COPY` source exists before shipping a Dockerfile |
| Script exits 1 silently under `set -e` | A trailing `[ -n "$X" ] && echo …` returns 1 when false, so `source` returns 1 and kills the caller | End sourced scripts with `true`, or use `if` blocks |
| `'ok' is specified more than once` | Object spread after an explicit key of the same name | Drop the redundant literal |
| `Block-scoped variable used before declaration` | A `useCallback` referencing another defined below it | Reorder definitions |
| Deploy rejects config | Unquoted YAML boolean/number — see `rules/00-core-invariants.md` | `npm run validate` |

## Standard build sequence

```bash
npm ci                       # never `npm install` in CI — lockfile is authoritative
npm run typecheck            # tsc --noEmit; catches what `next build` also would
NEXT_TELEMETRY_DISABLED=1 npm run build
npm run validate             # config sanity, after copying env.example.yaml
```

Type errors **fail** the Next build, so a clean build means types are consistent.
It does **not** mean the app works — that is `verification`'s job.

## Dependency rules

- **Cloud SDKs are dynamically imported.** `@google-cloud/storage`,
  `@google-cloud/bigquery` and `@aws-sdk/client-s3` load only when their driver is
  selected. Never add a top-level import of any of them — it would force every
  deployment to carry all three.
- `npm ci` in CI and images; `npm install` only when intentionally changing the
  lockfile.
- New dependency → check it does not break the standalone trace, and that the
  image still builds.

## Docker

Multi-stage: deps → builder → runner. The runner copies the standalone bundle,
static assets, and `scripts/preload-env.cjs` (needed by the `CMD`). Runs as a
non-root user with `/app/.data` as a volume.

```bash
docker build -t vendor-dashboard .
docker run -p 3000:3000 -v "$PWD/env.yaml:/app/env.yaml:ro" \
  -v "$PWD/data:/app/.data" vendor-dashboard
```

Mount `env.yaml`; do not convert it to `--env-file` with `sed`, which mangles
quoted values and JSON.

## CI

`.github/workflows/ci.yml` runs typecheck, build, config validation, and the
invariant sweeps (sole env reader, no double-scaled percentages). **When you add
an invariant to `rules/`, add its sweep to CI** — a convention nothing enforces
decays.

## Releases

```bash
npm run typecheck && npm run build && npm run validate
git tag vX.Y.Z && git push --tags
```

Bump `version` in `package.json` in the same commit. Note the repo's licence is
`PolyForm-Noncommercial-1.0.0` — source-available, not OSI open source — so do
not publish to a public npm registry without deciding that deliberately.

## Handoffs

- Build fails on a **type** error in a domain module → fix belongs to that
  domain's agent; you own the pipeline, not their logic.
- Build passes but behaviour is unproven → **`verification`**.
- Failure involves secrets, image provenance, or exposure → **`security-auditor`**.
- A build constraint forces an architectural change (e.g. a module cannot be
  imported client-side) → **`architect`** decides where the code moves.
