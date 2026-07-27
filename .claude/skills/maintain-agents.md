# The suite is out of date

Owner: **`agent-maintainer`**.

Triggers: a module was renamed or moved · a feature was added or removed · an
invariant changed · a new class of bug appeared · an agent gave outdated
guidance · routing sent work to the wrong agent.

```bash
node scripts/verify-agents.cjs        # what is provably stale
```

1. Run the check; fix everything it names.
2. Use the ownership map in `agent-maintainer` to find agents the change touches
   but the checker cannot detect — a still-valid path can sit next to a
   description of behaviour that no longer exists.
3. New failure class? Record the **cause**, not the symptom:
   build → `build-release` · wrong number → `data-integrity` ·
   invariant → `rules/00-core-invariants.md` · concept → `rules/01-domain-semantics.md`
4. Re-run the check; it must exit 0.

Adding an agent means five edits, not one: the file, the `AGENTS.md` routing
table, the agent count, any relevant skill, and cross-references from adjacent
agents.
