# Adding a feature

1. **`architect`** — where does this belong? Does it cross a boundary?
2. **Domain agent** — build it (see routing table in `AGENTS.md`).
3. **`security-auditor`** — only if it touches secrets, writes, or exposure.
4. **`verification`** — prove it. Build + a distinguishing fixture.
5. Report: what is proven, what is inferred, the one caveat that matters.

Deliver **complete files**, never diffs.
