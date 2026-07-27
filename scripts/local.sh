#!/usr/bin/env bash
# Run the dashboard locally — one command, no cloud account needed.
#
#     ./scripts/local.sh          # setup (if needed) + dev server on :3000
#     ./scripts/local.sh --prod   # production build + serve
#
# Creates env.yaml from the template on first run, forces local disk storage,
# and validates before starting. Works with no marketplace credentials: the UI
# runs and every panel explains what it needs rather than crashing.

set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-dev}"
PORT="${PORT:-3000}"

# ── node ──
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node is not installed. Node 20+ required." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ Node $(node -v) found; 20+ required." >&2
  exit 1
fi

# ── first-run config ──
if [ ! -f env.yaml ]; then
  echo "→ env.yaml not found; creating from env.example.yaml"
  cp env.example.yaml env.yaml
  # Local defaults: disk storage, warehouse off, no deploy target.
  sed -i.bak \
    -e 's|^STORAGE_DRIVER:.*|STORAGE_DRIVER: "local"|' \
    -e 's|^WAREHOUSE_ENABLED:.*|WAREHOUSE_ENABLED: "false"|' \
    -e 's|^DEPLOY_PLATFORM:.*|DEPLOY_PLATFORM: "other"|' \
    env.yaml && rm -f env.yaml.bak
  chmod 600 env.yaml
  echo "  created env.yaml (local disk storage, warehouse off)"
  echo "  add marketplace credentials to it when you want real data"
fi

# ── deps ──
if [ ! -d node_modules ]; then
  echo "→ installing dependencies"
  npm ci 2>/dev/null || npm install
fi

# ── validate before starting ──
echo "→ validating env.yaml"
node scripts/validate-env.cjs

mkdir -p "$(node -e "
  const fs=require('fs');
  const m=fs.readFileSync('env.yaml','utf8').match(/^STORAGE_LOCAL_DIR:\s*[\"']?([^\"'#\n]+)/m);
  process.stdout.write((m?m[1]:'.data').trim());
")"

echo ""
if [ "$MODE" = "--prod" ]; then
  echo "→ production build"
  npm run build
  # Standalone copies assets but does not include them automatically.
  cp -r .next/static .next/standalone/.next/ 2>/dev/null || true
  cp -r public .next/standalone/ 2>/dev/null || true
  echo ""
  echo "→ serving on http://localhost:${PORT}"
  # The standalone server runs with cwd=.next/standalone, so a RELATIVE
  # STORAGE_LOCAL_DIR would put your data inside the build output and lose it on
  # the next build. Pin it to an absolute path in the repo root.
  STORAGE_LOCAL_DIR="$(pwd)/${LOCAL_DATA_DIR:-.data}" \
  PORT="$PORT" node -r ./scripts/preload-env.cjs .next/standalone/server.js
else
  echo "→ dev server on http://localhost:${PORT}"
  echo "   health check: http://localhost:${PORT}/api/health"
  echo ""
  PORT="$PORT" npm run dev
fi
