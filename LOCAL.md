# Running locally

No cloud account, no credentials required to start. One command:

```bash
./scripts/local.sh
```

That will, on first run: create `env.yaml` from the template (local disk storage,
warehouse off), install dependencies, validate the config, and start the dev
server on <http://localhost:3000>.

Production build instead of dev:

```bash
./scripts/local.sh --prod
```

---

## What works without credentials

The whole UI runs. Every page renders and each panel explains what it needs
rather than crashing or showing a fake zero:

| Works now | Needs credentials | Needs a warehouse |
|---|---|---|
| All pages and navigation | Sync / real data | Suppression ledger |
| Config + health diagnostics | Margin panels | Fill risk |
| CSV upload paths | Listing submission | |

Check what is configured at any time:

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
```

`ready: false` with a `hints` array is expected before credentials are added —
it tells you exactly which variables are missing.

---

## Adding real data

Edit `env.yaml` and set the three marketplace credentials:

```yaml
LWA_CLIENT_ID: "amzn1.application-oa2-client...."
LWA_CLIENT_SECRET: "amzn1.oa2-cs...."
LWA_REFRESH_TOKEN: "Atzr|...."
```

Restart, then press **Sync**. Data is written to `.data/` as plain JSON — inspect
it, delete it to start over, back it up by copying the folder.

---

## Config rules that bite

**Quote every value in `env.yaml`.** YAML 1.1 turns bare `y`, `Y`, `n`, `N`,
`yes`, `no`, `on`, `off`, `true`, `false` into booleans and bare digits into
numbers. Cloud Run then rejects the file with an error that does not name the
key. `PO_ACCEPT_CODE: N` becomes `False`.

```bash
npm run validate          # catches this before a deploy does
```

The validator also checks for nested keys, malformed `VENDOR_CONTRACTS` JSON, and
combinations that cannot work (`gcs` driver with no bucket, warehouse enabled with
no project, local storage on an ephemeral platform).

---

## Ports and data location

```bash
PORT=4000 ./scripts/local.sh
```

Storage lives at `STORAGE_LOCAL_DIR` (default `.data`) in the repo root — for
both dev and `--prod`. The standalone server runs with its working directory set
to the build output, so `local.sh` pins an absolute path; without that, your
synced data would be written inside `.next/standalone/` and lost on the next
build.

---

## Docker instead

```bash
docker build -t vendor-dashboard .
docker run -p 3000:3000 \
  -v "$PWD/env.yaml:/app/env.yaml:ro" \
  -v "$PWD/data:/app/.data" \
  vendor-dashboard
```

Mount `env.yaml` directly — the container's preload reads it. (Converting YAML to
`--env-file` with `sed` breaks on quoted values and JSON, so mount the file.)

The `.data` volume is what makes `local` storage durable in a container. Without
it, everything is lost when the container stops.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Found False (type <class 'bool'>)` on deploy | An unquoted YAML boolean — run `npm run validate` |
| Data disappears after rebuild | `STORAGE_LOCAL_DIR` was relative under standalone; use `local.sh` |
| Pages load, all panels empty | No credentials yet, or no sync run — check `/api/health` |
| `env.yaml not found` | `cp env.example.yaml env.yaml` |
| Port already in use | `PORT=4000 ./scripts/local.sh` |
