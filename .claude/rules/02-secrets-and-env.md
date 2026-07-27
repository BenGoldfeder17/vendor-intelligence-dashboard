# env.yaml is off-limits

`env.yaml` is the single custom-configuration file. It holds marketplace
credentials, the snapshot token, deployment identity, and commercially sensitive
vendor contract terms.

## The rule

**Never read, open, cat, grep, copy, print or edit `env.yaml`.** Not to "check a
value", not to debug, not to confirm a setting is present.

This is enforced by deny rules in `.claude/settings.json`, but treat it as a rule
you follow regardless — the enforcement has known gaps (below).

## What to do instead

| You need | Do this |
|---|---|
| To know which keys exist | Read `env.example.yaml` — safe, committed, complete |
| To check config is loaded | `curl localhost:3000/api/health` — reports state, never values |
| To add a setting | Add it to `env.example.yaml` + `app.config.ts`; ask the operator to set the real value |
| To debug a wrong value | Ask the operator what it is set to; do not go looking |

`/api/health` exists precisely for this: it answers "is this configured and
working?" without ever echoing a secret. Keep it that way — never add a field
that returns an actual credential, bucket key, or token.

## Honest limits of the enforcement

Deny rules block the built-in file tools and common shell readers, and they keep
matched content out of the model's context entirely. But:

- They do **not** stop a Node/Python script that opens the file itself.
- There have been Claude Code releases where deny rules were not enforced at all.
- Nothing stops the file's contents being pasted into a conversation.

So: the rule is the primary control, the deny list is defence in depth, and
OS-level sandboxing is what you use when the guarantee has to be hard.

## Verify the block actually works

After changing `.claude/settings.json`, confirm it:

```
Ask: "read env.yaml"        → must be refused/blocked
Ask: "run: cat env.yaml"    → must be refused/blocked
```

If either succeeds, the deny rules are not being enforced in your version —
treat the file as unprotected and move real secrets to a secret manager.

## Related

- `env.yaml` is gitignored; `env.example.yaml` is committed.
- Secrets in production belong in a secret manager, injected as real environment
  variables. Real env vars always win over the file.
