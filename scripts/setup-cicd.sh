#!/usr/bin/env bash
# One-time setup so a push to main deploys to Cloud Run from GitHub Actions.
# Needs: gcloud (project owner) and gh (repo admin), both logged in. Safe to re-run.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-kid-splitter-prod}"
REPO="${REPO:-gabiacuna/kid-splitter}"
POOL="${POOL:-github}"
PROVIDER="${PROVIDER:-github-actions}"
SA_NAME="${SA_NAME:-github-deployer}"
ENV_NAME="${ENV_NAME:-production}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

echo "Enabling APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com --project "$PROJECT_ID"

echo "Service account ${SA_EMAIL}..."
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name "GitHub Actions deployer" --project "$PROJECT_ID"

# deploy.sh reads the secrets and project number, then `gcloud run deploy --source` builds with Cloud Build.
for role in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer roles/storage.admin \
            roles/iam.serviceAccountUser roles/serviceusage.serviceUsageConsumer roles/browser \
            roles/secretmanager.viewer roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${SA_EMAIL}" \
    --role "$role" --condition=None --quiet >/dev/null
done

echo "Workload Identity pool/provider (limited to ${REPO})..."
gcloud iam workload-identity-pools describe "$POOL" --location global --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub" --project "$PROJECT_ID"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" \
  --location global --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool "$POOL" \
       --location global --project "$PROJECT_ID" --issuer-uri "https://token.actions.githubusercontent.com" \
       --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
       --attribute-condition "assertion.repository=='${REPO}'"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser --quiet >/dev/null \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"

WIP="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

echo "GitHub environment '${ENV_NAME}' on ${REPO}..."
gh api -X PUT "repos/${REPO}/environments/${ENV_NAME}" >/dev/null
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env "$ENV_NAME" --repo "$REPO" --body "$WIP"
gh variable set GCP_SERVICE_ACCOUNT --env "$ENV_NAME" --repo "$REPO" --body "$SA_EMAIL"
gh variable set GCP_PROJECT_ID --env "$ENV_NAME" --repo "$REPO" --body "$PROJECT_ID"

echo "Done. Merging to main now runs the deploy job. Optional: add required reviewers to '${ENV_NAME}' in the repo settings."
