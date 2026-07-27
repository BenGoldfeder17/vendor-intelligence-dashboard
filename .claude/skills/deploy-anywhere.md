# Deploying to a new platform

Owner: **`config-portability`** (what to configure), with **`build-release`**
(the image and pipeline); **`security-auditor`** signs off.

1. Choose storage: `local` only where the filesystem is durable. On Cloud Run /
   App Runner / Lambda / Fly use `s3`/`gcs` or a mounted volume — otherwise state
   is lost on every cold start.
2. Inject env (secret manager preferred; instance/task roles over static keys).
3. Build the Docker image — it is the same everywhere.
4. **Put an auth layer in front.** The app has none.
5. Set `SNAPSHOT_TOKEN`.
6. `curl /api/health`.
7. Schedule the weekly snapshot and (optionally) the Net PPM pull.
