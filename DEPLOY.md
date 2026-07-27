# Deployment

The app is a standard **Next.js standalone** server. It has no hard dependency on
any cloud provider: pick a storage driver, set environment variables, run the
container (or `node server.js`). Everything configurable lives in
`src/config/app.config.ts`, driven by `.env` — see `.env.example`.

---

## 0. Configure

```bash
cp .env.example .env
# fill in LWA_CLIENT_ID / LWA_CLIENT_SECRET / LWA_REFRESH_TOKEN at minimum
```

Then verify any deployment with the built-in check:

```bash
curl -s https://<your-host>/api/health | jq
```

It reports what is configured, whether storage is writable, and what is missing —
without ever echoing a secret.

---

## 1. Choose a storage driver

State (synced aggregate, uploaded reference tables, cached report documents) is
stored as JSON documents. Pick where they live:

| Driver | Use when | Required vars |
|---|---|---|
| `local` | VM, SSH server, Docker with a volume, laptop | `STORAGE_LOCAL_DIR` |
| `s3` | AWS, or any S3-compatible store (MinIO, R2, Wasabi) | `STORAGE_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT` |
| `gcs` | Google Cloud | `STORAGE_BUCKET` |

> **Ephemeral filesystems.** Cloud Run, App Runner, Lambda and Fly machines wipe
> the container filesystem on cold start. On those, use `s3`/`gcs`, or mount a
> persistent volume and point `STORAGE_LOCAL_DIR` at it. With `local` on an
> ephemeral host you will silently lose synced data on every restart.

---

## 2. Docker (works on every platform below)

```bash
docker build -t vendor-dashboard .
docker run -d --name vendor-dashboard \
  -p 3000:3000 \
  --env-file .env \
  -v "$PWD/data:/app/.data" \
  vendor-dashboard
```

The volume mount is what makes `STORAGE_DRIVER=local` durable. Drop it if you use
`s3`/`gcs`.

---

## 3. Plain SSH server / VM (no container)

```bash
# Node 20+ required
npm ci
npm run build
cp .env.example .env && $EDITOR .env

# run it
node .next/standalone/server.js      # or: npm start
```

Keep it alive with systemd:

```ini
# /etc/systemd/system/vendor-dashboard.service
[Unit]
Description=Vendor Intelligence Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/vendor-dashboard
EnvironmentFile=/opt/vendor-dashboard/.env
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now vendor-dashboard
```

Put nginx/Caddy in front for TLS. **The app has no built-in authentication** — see
§7.

---

## 4. AWS

**App Runner** (simplest):
```bash
# push image to ECR, then create an App Runner service from it
aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
docker build -t vendor-dashboard .
docker tag vendor-dashboard <acct>.dkr.ecr.<region>.amazonaws.com/vendor-dashboard:latest
docker push <acct>.dkr.ecr.<region>.amazonaws.com/vendor-dashboard:latest
```
Set `STORAGE_DRIVER=s3`, `STORAGE_BUCKET=...`, and attach an instance role with
`s3:GetObject/PutObject/DeleteObject` on that bucket. Credentials resolve
automatically from the role — no keys in env.

**ECS/Fargate**: same image, task role instead of instance role.
**EC2**: use the SSH/systemd recipe above; `local` storage is fine on EBS.

---

## 5. Google Cloud

**Cloud Run**:
```bash
gcloud run deploy vendor-dashboard --source . --region=us-central1 \
  --service-account="<sa>@<project>.iam.gserviceaccount.com" \
  --set-env-vars="STORAGE_DRIVER=gcs,STORAGE_BUCKET=<bucket>" \
  --set-secrets=LWA_CLIENT_ID=LWA_CLIENT_ID:latest,LWA_CLIENT_SECRET=LWA_CLIENT_SECRET:latest,LWA_REFRESH_TOKEN=LWA_REFRESH_TOKEN:latest
```
Grant the service account `roles/storage.objectAdmin` on the bucket. For the
optional warehouse panels also grant `roles/bigquery.dataViewer` on the source
dataset **and** `roles/bigquery.jobUser` on the project (both are required —
dataViewer alone cannot run queries).

**GCE**: use the SSH/systemd recipe.

---

## 6. Anywhere else

Azure Container Apps, Fly.io, Render, Railway, Coolify, Dokku, Kubernetes — all
take the Dockerfile unchanged. The only decisions are the storage driver and how
env vars are injected.

Kubernetes sketch:
```yaml
envFrom:
  - secretRef:
      name: vendor-dashboard-env
```

---

## 7. Security — read this

**The app ships with no authentication.** It exposes your vendor margin data and
can submit listings. Do not expose it to the internet unprotected. Put it behind
one of:

- an identity-aware proxy (GCP IAP, AWS ALB + Cognito/OIDC, Cloudflare Access)
- your VPN / private network
- a reverse-proxy auth layer (oauth2-proxy, Authelia, basic auth in nginx)

Additionally set `SNAPSHOT_TOKEN` (`openssl rand -hex 32`). It guards the one
endpoint that writes to your warehouse, so a scheduler can call it without a
browser session and an authenticated human can't trigger writes by accident.

---

## 8. Scheduled jobs (optional)

Two endpoints are worth running on a schedule. Both are plain HTTP — use cron,
Cloud Scheduler, EventBridge, or a Kubernetes CronJob.

```bash
# Weekly: snapshot suppression + replenishment state.
# This CANNOT be backfilled — every week it doesn't run is history you never get.
curl -X POST "https://<host>/api/risk/snapshot?token=$SNAPSHOT_TOKEN"

# Periodic: refresh Net PPM (starts an async query; collect completes it).
curl -X POST "https://<host>/api/net-ppm/pull"
curl -s  "https://<host>/api/net-ppm/pull"    # call again later to collect
```

Plain crontab:
```cron
0 6 * * 1 curl -fsS -X POST "https://<host>/api/risk/snapshot?token=TOKEN" >/dev/null
```

---

## 9. Upgrading / changing configuration

All tenant-specific values are in `.env` (mapped by `src/config/app.config.ts`).
Changing thresholds, brand labels, table names, or suppression codes needs only
an env change and a restart — no code edit, no rebuild.

The one exception worth care: **`SUPPRESSION_CODES` must match your item-master's
real legend.** A code that actually means "in stock, ship it" classified as a
suppression will inflate the suppression ledger by thousands of styles.
