# Contributing

## Getting started

```bash
cp env.example.yaml env.yaml
./scripts/local.sh
```

Runs with no credentials — every panel explains what it needs. See
[LOCAL.md](LOCAL.md).

## Before opening a PR

```bash
npm run typecheck
npm run build
npm run validate
```

## Project conventions

These exist because the project broke in each of these ways at least once.
`.claude/rules/` has the full text.

1. **`src/config/app.config.ts` is the only file that reads `process.env`.**
   ```bash
   grep -rn "process\.env" src/ --include=*.ts --include=*.tsx | grep -v config/app.config
   ```
   Must return nothing.

2. **`percent()` takes a fraction and already multiplies by 100.**
   `percent(x * 100)` double-scales — it once rendered a 32.75% floor as
   "+3275%" and every margin figure 100× too large.

3. **Quote every value in YAML config.** YAML 1.1 turns bare `y/Y/n/N/yes/no/
   on/off` into booleans and bare digits into numbers.

4. **Never infer a vendor code's meaning from its letter.** A code meaning
   "in stock, ship it" once got classified as a suppression and inflated a
   ledger by ~7,800 styles.

5. **Analysis functions stay pure.** Pass data in rather than reaching for
   global state — it is why the logic is testable without a network.

6. **Verify by running.** Compiling is not working. Include the output that
   demonstrates a behaviour change, and say which numbers came from fixtures.

## Architecture

Dependencies point inward only:

```
config → storage / marketplace clients / warehouse → analysis → API routes → components
```

Business logic never lives in an API route. Components never import an analysis
module directly — the API layer is the boundary.

## Agent-assisted development

`.claude/` ships a suite of scoped agents (architecture, security, marketplace
API, margin analytics, warehouse, sync, UI, config, verification, data
integrity). See [AGENTS.md](AGENTS.md). They encode the conventions above, so
they are worth using even if you work manually.
