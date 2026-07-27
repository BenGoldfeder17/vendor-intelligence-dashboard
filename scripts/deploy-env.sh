#!/usr/bin/env bash
# Export deployment variables into the current shell.
#
#     source scripts/deploy-env.sh
#
# Reads .env (the same file the app reads) so there is ONE source of truth —
# no retyping exports each SSH session, and no drift between what you deploy
# with and what the app is configured with.
#
# Safe to source repeatedly. Sets nothing if .env is absent.

_deploy_env_file="${DEPLOY_ENV_FILE:-.env}"

if [ ! -f "$_deploy_env_file" ]; then
  echo "deploy-env: $_deploy_env_file not found — copy .env.example to .env first." >&2
  return 1 2>/dev/null || exit 1
fi

# Read KEY=VALUE lines, ignoring comments/blanks. Values are taken literally
# (no shell expansion) so a '#' or '$' inside a secret can't break anything.
while IFS= read -r _line || [ -n "$_line" ]; do
  case "$_line" in
    ''|'#'*) continue ;;
  esac
  _key="${_line%%=*}"
  _val="${_line#*=}"
  # trim surrounding whitespace + optional quotes
  _key="$(printf '%s' "$_key" | tr -d '[:space:]')"
  _val="${_val#"${_val%%[![:space:]]*}"}"
  _val="${_val%"${_val##*[![:space:]]}"}"
  case "$_val" in
    \"*\") _val="${_val#\"}"; _val="${_val%\"}" ;;
    \'*\') _val="${_val#\'}"; _val="${_val%\'}" ;;
  esac
  [ -n "$_key" ] && export "$_key=$_val"
done < "$_deploy_env_file"

# ── Convenience aliases matching common deploy-command variable names ──
export PROJECT_ID="${DEPLOY_PROJECT_ID:-}"
export REGION="${DEPLOY_REGION:-}"
export SERVICE="${DEPLOY_SERVICE:-}"
export SERVICE_URL="${DEPLOY_SERVICE_URL:-}"
export RUNTIME_SA="${DEPLOY_RUNTIME_IDENTITY:-}"
export BUCKET="${STORAGE_BUCKET:-}"

# Resolve the GCP project number if not pinned and gcloud is available.
if [ -z "${DEPLOY_PROJECT_NUMBER:-}" ] && [ "${DEPLOY_PLATFORM:-}" = "gcp" ] \
   && [ -n "$PROJECT_ID" ] && command -v gcloud >/dev/null 2>&1; then
  DEPLOY_PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" \
    --format='value(projectNumber)' 2>/dev/null || true)"
  export DEPLOY_PROJECT_NUMBER
fi
export PROJECT_NUMBER="${DEPLOY_PROJECT_NUMBER:-}"

# Fully-qualified runtime identity (GCP service-account email).
if [ "${DEPLOY_PLATFORM:-}" = "gcp" ] && [ -n "$RUNTIME_SA" ] \
   && [ -n "$PROJECT_ID" ] && [ "${RUNTIME_SA#*@}" = "$RUNTIME_SA" ]; then
  export RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
else
  export RUNTIME_SA_EMAIL="$RUNTIME_SA"
fi

echo "deploy-env: ${DEPLOY_PLATFORM:-other} | ${SERVICE:-?} | ${REGION:-?} | ${PROJECT_ID:-?}"
if [ -n "$RUNTIME_SA_EMAIL" ]; then echo "            runtime identity: $RUNTIME_SA_EMAIL"; fi
if [ -n "$SERVICE_URL" ];      then echo "            url: $SERVICE_URL"; fi

# Return success explicitly: a trailing conditional that evaluates false would
# make `source` return non-zero and kill any caller running under `set -e`.
true
