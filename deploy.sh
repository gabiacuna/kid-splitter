#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-kid-splitter-prod}"
SERVICE_NAME="${SERVICE_NAME:-kid-splitter}"
REGION="${REGION:-us-central1}"
SECRETS=(DATABASE_URL SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SECRET_KEY)

# Fail fast if a secret is missing; otherwise Cloud Run builds the image and then
# rejects the revision with SecretsAccessCheckFailed.
missing=()
for s in "${SECRETS[@]}"; do
  gcloud secrets versions describe latest --secret "$s" --project "$PROJECT_ID" >/dev/null 2>&1 || missing+=("$s")
done
if ((${#missing[@]})); then
  echo "Missing Secret Manager secrets in ${PROJECT_ID}: ${missing[*]}" >&2
  echo "Create each with: printf '%s' '<value>' | gcloud secrets create <NAME> --data-file=- --project ${PROJECT_ID}" >&2
  exit 1
fi

# Inside Cloud Run, localhost is the container itself: a local DATABASE_URL breaks every DB request.
if gcloud secrets versions access latest --secret DATABASE_URL --project "$PROJECT_ID" | grep -qE '@(localhost|127\.0\.0\.1)([:/]|$)'; then
  echo "DATABASE_URL secret points to localhost. Set it to the Supabase transaction pooler (port 6543):" >&2
  echo "  printf '%s' '<url>' | gcloud secrets versions add DATABASE_URL --data-file=- --project ${PROJECT_ID}" >&2
  exit 1
fi

# Cloud Run's deterministic URL: https://SERVICE-PROJECT_NUMBER.REGION.run.app
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
APP_URL="${APP_URL:-https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app}"

secret_flags=""
for s in "${SECRETS[@]}"; do secret_flags+="${s}=${s}:latest,"; done
secret_flags="${secret_flags%,}"

echo "Deploying ${SERVICE_NAME} to project ${PROJECT_ID} (${REGION}) at ${APP_URL}..."

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --memory 1Gi \
  --cpu 1 \
  --cpu-throttling \
  --set-env-vars "ENV=production,FRONTEND_URL=${APP_URL},SHARE_BASE_URL=${APP_URL}" \
  --set-secrets "${secret_flags}" \
  "$@"
