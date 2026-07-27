# Core invariants — always follow

Every rule here exists because this project already broke in that exact way.

## 1. SQL and data-mutation governance

**Any SQL or query you hand the operator must state, in bold and up front,
whether it changes anything.**

```
**READ-ONLY — this query changes nothing.**
**⚠ THIS MODIFIES DATA.**
```

**Never alter a table the operator did not create.** Source datasets are
read-only. The app writes to exactly one place: its own snapshot dataset, via
`insertSnapshotRows()`. If a task seems to require writing elsewhere, stop and
ask rather than proceeding.

## 2. Configuration has one home

`src/config/app.config.ts` is the **only** file permitted to read `process.env`.
Everything else imports from it. Adding a `process.env` read anywhere else is a
regression — there is a sweep for it:

```bash
grep -rn "process\.env" src/ --include=*.ts --include=*.tsx | grep -v "config/app.config"
```

That must return nothing.

## 3. Never claim something exists without opening it

This project shipped a comment reading *"the hook is `coopPerUnit` below"* when
no such hook existed, and that claim was repeated across several sessions before
anyone checked. Before describing any function, field or capability:

```bash
grep -rn "theThing" src/
```

If it is not there, say so. An honest "not built" beats a confident fiction.

## 4. Verify by running, not by reasoning

Compiling is not working. A change is done when its behaviour is demonstrated —
a unit check, a real file parsed, an actual output pasted. State plainly which
parts are proven and which are inferred.

Specifically: **never present a number as verified if it came from synthetic
fixtures.** Say "against test fixtures" or "against your real export".

## 5. Deliver complete files

The operator applies changes as whole-file replacements. Never hand back a diff,
a fragment, or "add this near line 40". Full, runnable file contents only.

## 6. Percentages: `percent()` already multiplies by 100

`src/lib/format.ts::percent()` takes a **fraction** and renders a percent.
Calling `percent(x * 100)` double-scales — this shipped and rendered a 32.75%
floor as "+3275%" and every margin figure 100× too large across two components.

- Values in the codebase are stored as **fractions** (`0.3275`).
- Basis-point inputs from exports are `/10000`.
- Percent-form inputs from exports are `/100`.

## 7. Cache keys must be provably immutable

The report cache is keyed on `reportDocumentId`, which is safe because the
marketplace issues a **new** id when content changes — so a changed report misses
the cache. Any new cache must have an equivalent argument, or it will serve stale
data. "Cache for N hours" is not an argument.

## 8. Long marketplace jobs never block a request

Data Kiosk queries take minutes. Polling inside an HTTP handler hit both the
5-minute internal cap and the platform request timeout. The pattern is
**submit → persist the id → collect later**. Never reintroduce synchronous polling.
