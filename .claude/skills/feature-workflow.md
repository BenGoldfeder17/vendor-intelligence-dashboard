# Adding a feature

1. **`architect`** — where does this belong? Does it cross a boundary?
2. **Domain agent** — build it (see routing table in `AGENTS.md`).
3. **`build-release`** — does it compile and package? Any new dependency traced?
4. **`security-auditor`** — only if it touches secrets, writes, or exposure.
5. **`verification`** — prove it. A distinguishing fixture, not just a green build.
6. Report: what is proven, what is inferred, the one caveat that matters.

Deliver **complete files**, never diffs.

If step 3 fails, stay with `build-release` — do not start rewriting logic. Most
build failures here are known pipeline issues with a catalogued fix.
