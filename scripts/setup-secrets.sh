#!/usr/bin/env bash
# Interactive secret setup. Prompts for each secret, stores it in a secret
# manager, and never writes it to disk.
#
#     ./scripts/setup-secrets.sh gcp   PROJECT_ID RUNTIME_SA_EMAIL
#     ./scripts/setup-secrets.sh aws   REGION
#
# See SECRETS.md for why secrets do not belong in env.yaml.

set -euo pipefail

PLATFORM="${1:-}"
SECRETS=(LWA_CLIENT_ID LWA_CLIENT_SECRET LWA_REFRESH_TOKEN SNAPSHOT_TOKEN VENDOR_CONTRACTS)

case "$PLATFORM" in
  gcp)
    PROJECT="${2:?usage: setup-secrets.sh gcp PROJECT_ID RUNTIME_SA_EMAIL}"
    SA="${3:?usage: setup-secrets.sh gcp PROJECT_ID RUNTIME_SA_EMAIL}"
    for KEY in "${SECRETS[@]}"; do
      printf 'Value for %s (blank to skip): ' "$KEY"
      read -rs VALUE; echo
      [ -z "$VALUE" ] && { echo "  skipped"; continue; }
      if gcloud secrets describe "$KEY" --project="$PROJECT" >/dev/null 2>&1; then
        printf '%s' "$VALUE" | gcloud secrets versions add "$KEY" --data-file=- --project="$PROJECT" >/dev/null
        echo "  new version added"
      else
        printf '%s' "$VALUE" | gcloud secrets create "$KEY" --data-file=- --project="$PROJECT" >/dev/null
        echo "  created"
      fi
      gcloud secrets add-iam-policy-binding "$KEY" \
        --member="serviceAccount:$SA" \
        --role="roles/secretmanager.secretAccessor" \
        --project="$PROJECT" >/dev/null
      unset VALUE
    done
    echo ""
    echo "Add to your deploy command:"
    printf '  --set-secrets='
    printf '%s=%s:latest,' "${SECRETS[@]/%/}" | sed 's/,$//' \
      | awk '{n=split($0,a,","); for(i=1;i<=n;i++){split(a[i],b,"="); printf "%s%s=%s:latest", (i>1?",":""), b[1], b[1]}}'
    echo ""
    ;;

  aws)
    REGION="${2:?usage: setup-secrets.sh aws REGION}"
    for KEY in "${SECRETS[@]}"; do
      printf 'Value for %s (blank to skip): ' "$KEY"
      read -rs VALUE; echo
      [ -z "$VALUE" ] && { echo "  skipped"; continue; }
      aws secretsmanager create-secret --name "$KEY" --secret-string "$VALUE" --region "$REGION" >/dev/null 2>&1 \
        || aws secretsmanager put-secret-value --secret-id "$KEY" --secret-string "$VALUE" --region "$REGION" >/dev/null
      echo "  stored"
      unset VALUE
    done
    echo ""
    echo "Reference these in your ECS task definition 'secrets' block."
    ;;

  *)
    echo "usage: setup-secrets.sh {gcp|aws} ..." >&2
    echo "  gcp PROJECT_ID RUNTIME_SA_EMAIL" >&2
    echo "  aws REGION" >&2
    exit 1
    ;;
esac
