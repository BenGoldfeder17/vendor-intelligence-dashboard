# Security Policy

## ⚠ This application has no built-in authentication

It exposes commercially sensitive margin data and can submit product listings to
a live marketplace account. **Do not expose it to the internet unprotected.**

Put it behind one of:

- an identity-aware proxy (Google IAP, AWS ALB + OIDC/Cognito, Cloudflare Access)
- a VPN or private network
- a reverse-proxy auth layer (oauth2-proxy, Authelia, nginx basic auth)

This is a deliberate design decision — the app assumes your platform owns
authentication — but it means an unprotected deployment leaks everything.

## Secrets

- `env.yaml` holds credentials and is **gitignored**. Never commit it.
- `env.example.yaml` is the safe, committed template.
- In production, prefer a secret manager injecting real environment variables.
  Real env vars always take precedence over the file.
- `SNAPSHOT_TOKEN` guards the only endpoint that writes to your warehouse.
  Generate with `openssl rand -hex 32`.

## Data access model

- All warehouse reads pass through a guard that rejects anything but a lone
  `SELECT`/`WITH` (comments stripped first, so a write cannot hide behind `--`).
- Exactly one function writes to the warehouse, and only to an app-owned
  snapshot dataset. Source datasets are structurally unwritable.
- Grant the runtime identity **read-only** access to your source data.

## Reporting a vulnerability

Open a private security advisory through GitHub's "Report a vulnerability"
feature rather than a public issue. Include reproduction steps and the affected
version/commit.

Please do not include real credentials, ASINs, or vendor data in a report.

## Before you deploy

```bash
npm run validate                      # config sanity
curl -s <host>/api/health             # reports state, never secrets
```

`/api/health` is designed never to echo a credential. If you extend it, keep it
that way.
