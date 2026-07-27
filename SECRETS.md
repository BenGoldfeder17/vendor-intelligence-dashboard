# Secrets

## The principle

**Do not try to hide a secret from something that has shell access. Remove the
secret from the machine.**

Permission systems — including AI coding-agent deny-lists — block the built-in
file tools. They do not stop a script the agent writes, because the OS grants
read access to the user, not the tool. Anything running as your user can read
any file your user can read.

So the guarantee does not come from blocking reads. It comes from the secret not
being there: injected as a real environment variable at deploy time, from a
secret manager. Real environment variables always take precedence over
`env.yaml`, so nothing in the code changes.

## Two tiers

| Tier | Examples | Where it lives |
|---|---|---|
| **Secret** | API credentials, `SNAPSHOT_TOKEN`, `VENDOR_CONTRACTS` | Secret manager → injected env var |
| **Configuration** | thresholds, table names, brand labels, region, bucket | `env.yaml` — not sensitive |

The authoritative list is `SECRET_KEYS` in `src/config/app.config.ts`.
`npm run validate` **fails** if any of them has a value in `env.yaml`.

Note that `VENDOR_CONTRACTS` is on the secret list despite not being a
credential. Negotiated margin floors and allowance percentages are commercially
confidential — in practice the most sensitive values in this project.

Once the secrets are out, **`env.yaml` contains nothing worth hiding.** You can
hand it to an agent, paste it in a ticket, or commit it if you wanted to.

## Setting it up

### Google Cloud

```bash
PROJECT=your-project
SA=your-runtime-sa@your-project.iam.gserviceaccount.com

for KEY in LWA_CLIENT_ID LWA_CLIENT_SECRET LWA_REFRESH_TOKEN SNAPSHOT_TOKEN VENDOR_CONTRACTS; do
  read -rsp "$KEY: " VALUE; echo
  printf '%s' "$VALUE" | gcloud secrets create "$KEY" --data-file=- --project="$PROJECT" 2>/dev/null \
    || printf '%s' "$VALUE" | gcloud secrets versions add "$KEY" --data-file=- --project="$PROJECT"
  gcloud secrets add-iam-policy-binding "$KEY" \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" --project="$PROJECT"
done
```

Then on deploy:

```bash
gcloud run deploy "$SERVICE" --source . --region="$REGION" \
  --set-secrets=LWA_CLIENT_ID=LWA_CLIENT_ID:latest,LWA_CLIENT_SECRET=LWA_CLIENT_SECRET:latest,LWA_REFRESH_TOKEN=LWA_REFRESH_TOKEN:latest,SNAPSHOT_TOKEN=SNAPSHOT_TOKEN:latest,VENDOR_CONTRACTS=VENDOR_CONTRACTS:latest \
  --env-vars-file=env.yaml
```

### AWS

Store in Secrets Manager or SSM Parameter Store, then reference them in the ECS
task definition's `secrets` block, or App Runner's secret references. Use the
task role — never static keys in env.

### Docker / self-hosted

```bash
docker run --env-file <(pass show vendor-dashboard/secrets) \
  -v "$PWD/env.yaml:/app/env.yaml:ro" \
  -v "$PWD/data:/app/.data" vendor-dashboard
```

Or Docker secrets / your orchestrator's secret mechanism. The requirement is
only that they arrive as environment variables.

### Local development

The app runs with **no credentials at all** — the UI works and every panel
explains what it needs. Add real credentials only when testing against real data.

If you do need them locally, keep them outside the repo and readable only by
your user:

```bash
mkdir -p ~/.config/vendor-dashboard && chmod 700 ~/.config/vendor-dashboard
$EDITOR ~/.config/vendor-dashboard/secrets.env && chmod 600 ~/.config/vendor-dashboard/secrets.env

set -a; . ~/.config/vendor-dashboard/secrets.env; set +a
./scripts/local.sh
```

For a hard boundary against an agent running on the same machine, run the agent
as a **different OS user** with no read access to that file. That is enforced by
the kernel rather than by a tool's permission layer.

## Rotation

Nothing in the repo needs to change — issue a new secret version and redeploy.

```bash
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets versions add SNAPSHOT_TOKEN --data-file=-
```

If you rotate `SNAPSHOT_TOKEN`, update any scheduler job that passes it in a URL,
or the weekly snapshot silently starts returning 401 — and that job's history
cannot be backfilled.

## If a secret was ever committed

`.gitignore` only protects going forward. A credential in git history is
published the moment the repo is pushed.

1. **Rotate it.** Assume it is compromised. Scrubbing history does not un-leak it.
2. Then rewrite history with
   [git-filter-repo](https://github.com/newren/git-filter-repo), or start a fresh
   repository with no history.

Enable **Settings → Code security → Secret scanning + Push protection** to block
the next one before it lands.
