#!/usr/bin/env bash
# Deploy using the values in .env — no hand-typed flags, no drift.
#
#     ./scripts/deploy.sh              # deploy to DEPLOY_PLATFORM
#     ./scripts/deploy.sh --dry-run    # print the command without running it
#
# Platform is read from DEPLOY_PLATFORM (gcp | aws | docker | ssh).

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source scripts/deploy-env.sh

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s\n' "$*"
  else
    "$@"
  fi
}

case "${DEPLOY_PLATFORM:-other}" in

  gcp)
    : "${PROJECT_ID:?DEPLOY_PROJECT_ID is required}"
    : "${REGION:?DEPLOY_REGION is required}"
    : "${SERVICE:?DEPLOY_SERVICE is required}"

    # Secrets stay in Secret Manager; everything else comes from .env.
    SECRET_FLAGS="LWA_CLIENT_ID=LWA_CLIENT_ID:latest"
    SECRET_FLAGS="$SECRET_FLAGS,LWA_CLIENT_SECRET=LWA_CLIENT_SECRET:latest"
    SECRET_FLAGS="$SECRET_FLAGS,LWA_REFRESH_TOKEN=LWA_REFRESH_TOKEN:latest"

    run gcloud run deploy "$SERVICE" \
      --source . \
      --region="$REGION" \
      --project="$PROJECT_ID" \
      --no-allow-unauthenticated \
      ${RUNTIME_SA_EMAIL:+--service-account="$RUNTIME_SA_EMAIL"} \
      --min-instances="${DEPLOY_MIN_INSTANCES:-1}" \
      --max-instances="${DEPLOY_MAX_INSTANCES:-1}" \
      --no-cpu-throttling \
      --timeout="${DEPLOY_TIMEOUT_SECONDS:-3600}" \
      --memory="${DEPLOY_MEMORY:-1Gi}" \
      --set-secrets="$SECRET_FLAGS" \
      --env-vars-file=env.yaml
    ;;

  aws)
    : "${DEPLOY_IMAGE:?DEPLOY_IMAGE (ECR repo URI) is required}"
    run docker build -t "$DEPLOY_IMAGE" .
    run docker push "$DEPLOY_IMAGE"
    echo "Image pushed. Update the App Runner / ECS service to this image:"
    echo "  $DEPLOY_IMAGE"
    ;;

  docker|ssh|other)
    IMAGE="${DEPLOY_IMAGE:-${SERVICE:-vendor-dashboard}}"
    run docker build -t "$IMAGE" .
    echo ""
    echo "Built $IMAGE. Run it with:"
    echo "  docker run -d --name ${SERVICE:-vendor-dashboard} -p 3000:3000 \\"
    echo "    --env-file .env -v \"\$PWD/data:/app/.data\" $IMAGE"
    ;;

  *)
    echo "Unknown DEPLOY_PLATFORM='${DEPLOY_PLATFORM}'. Use gcp | aws | docker | ssh." >&2
    exit 1
    ;;
esac
