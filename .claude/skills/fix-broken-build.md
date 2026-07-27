# The build is broken

Owner: **`build-release`**. Do not debug from first principles until you have
checked its failure catalogue — every entry there actually happened in this repo.

1. Get the real error; the summary line is often not the cause:
   ```bash
   NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -30
   ```
2. Match it against the catalogue in `.claude/agents/build-release.md`.
3. Most frequent causes, in order:
   - `node:fs` in a module reachable from a **client** component
   - a relative import written at the wrong directory depth
   - `node_modules` missing → `npm ci`
   - a `COPY` in the Dockerfile pointing at a path that does not exist
   - `set -e` killed by a trailing `&&` in a sourced script
4. If the failure is a **type error inside domain logic**, hand to that domain's
   agent — `build-release` owns the pipeline, not their logic.
5. If fixing it requires moving code across a layer, **`architect`** decides where.

Once green, hand to **`verification`** — compiling is not working.
