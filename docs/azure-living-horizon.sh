#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Living Horizon — create everything on Azure and wire it to GitHub, once.
# ─────────────────────────────────────────────────────────────────────────
# Run this in Azure CLOUD SHELL (the >_ icon at the top of portal.azure.com,
# Bash mode). Cloud Shell already has `az` signed in as you and `gh` installed.
#
#   curl -fsSL https://raw.githubusercontent.com/nasirkhamlichi1-hub/lad/main/docs/azure-living-horizon.sh -o lh.sh
#   ADMIN_EMAIL=you@livinghorizon.com ADMIN_PASSWORD='Choose-A-Temp-Pass-1' bash lh.sh
#
# What it does (idempotent — safe to re-run):
#   1. Resource group, Linux App Service plan (B1), Web App for Containers
#      running ghcr.io/<owner>/lad-clpd-backend:latest with APP_BRAND=living-horizon,
#      persistent storage, and every application setting from docs/LIVING-HORIZON.md.
#   2. A Static Web App for the portal (living-horizon/).
#   3. GitHub: stores the SWA deploy token and the App Service publish profile as
#      repo secrets, sets LIVING_HORIZON_WEBAPP_NAME, points runtime-config.js at
#      the new API (one commit to main), and runs both deploy workflows.
#   4. Waits for the API to answer with brand=living-horizon and prints the URLs.
#
# Variables you may override (defaults in brackets):
#   ADMIN_EMAIL, ADMIN_PASSWORD   the first super admin (required; password 8+ chars)
#   ADMIN_NAME                    ["Training Administrator"]
#   ANTHROPIC_API_KEY             the AI trainer's brain and AI drafting (optional)
#   LOCATION                      [uaenorth]
#   RG                            [rg-living-horizon-training]
#   API_NAME                      [living-horizon-training-api]   (must be globally unique)
#   SWA_NAME                      [living-horizon-training]
#   REPO                          [nasirkhamlichi1-hub/lad]
#   GHCR_USER / GHCR_TOKEN        only if the GHCR package is private (a GitHub PAT with read:packages)
set -euo pipefail

: "${ADMIN_EMAIL:?Set ADMIN_EMAIL=you@livinghorizon.com}"
: "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD='a temporary password (8+ chars)'}"
ADMIN_NAME="${ADMIN_NAME:-Training Administrator}"
LOCATION="${LOCATION:-uaenorth}"
RG="${RG:-rg-living-horizon-training}"
PLAN="${PLAN:-plan-living-horizon-training}"
API_NAME="${API_NAME:-living-horizon-training-api}"
SWA_NAME="${SWA_NAME:-living-horizon-training}"
REPO="${REPO:-nasirkhamlichi1-hub/lad}"
OWNER="${REPO%%/*}"
IMAGE="ghcr.io/${OWNER}/lad-clpd-backend:latest"
# Static Web Apps are not offered in every region; uaenorth is not one of them.
SWA_LOCATION="${SWA_LOCATION:-westeurope}"

say(){ printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }

say "Checking tools and sign-in"
command -v az >/dev/null || { echo "az CLI not found — run this in Azure Cloud Shell"; exit 1; }
command -v gh >/dev/null || { echo "gh CLI not found — run this in Azure Cloud Shell"; exit 1; }
az account show --query "{subscription:name, user:user.name}" -o table
if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub: sign in once (a code appears — paste it in the browser tab that opens)."
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth setup-git >/dev/null 2>&1 || true
ok "signed in to Azure and GitHub"

say "Making sure the backend image on GHCR already carries the Living Horizon brand"
MAIN_SHA=$(gh api "repos/${REPO}/commits/main" --jq .sha)
BUILT=$(gh run list --repo "$REPO" --workflow backend.yml --branch main --status success --limit 5 --json headSha --jq '.[].headSha' | grep -c "$MAIN_SHA" || true)
if [ "$BUILT" = "0" ]; then
  echo "The backend image for main@${MAIN_SHA:0:7} has not finished building yet."
  echo "Wait for the 'backend' workflow at https://github.com/${REPO}/actions to go green, then re-run this script."
  echo "(Starting the App Service on an older image would apply the LAD data to the new database.)"
  exit 1
fi
ok "image for main@${MAIN_SHA:0:7} is built"

say "Resource group ${RG} in ${LOCATION}"
az group create -n "$RG" -l "$LOCATION" -o none
ok "ready"

say "App Service plan ${PLAN} (Linux B1, one instance)"
az appservice plan create -g "$RG" -n "$PLAN" --is-linux --sku B1 --number-of-workers 1 -o none
ok "ready"

say "Web App for Containers ${API_NAME} ← ${IMAGE}"
if ! az webapp show -g "$RG" -n "$API_NAME" >/dev/null 2>&1; then
  az webapp create -g "$RG" -p "$PLAN" -n "$API_NAME" --container-image-name "$IMAGE" -o none
fi
if [ -n "${GHCR_USER:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  az webapp config container set -g "$RG" -n "$API_NAME" --container-image-name "$IMAGE" \
    --container-registry-url https://ghcr.io --container-registry-user "$GHCR_USER" --container-registry-password "$GHCR_TOKEN" -o none
fi
API_HOST=$(az webapp show -g "$RG" -n "$API_NAME" --query defaultHostName -o tsv)
API_URL="https://${API_HOST}"
ok "$API_URL"

say "Static Web App ${SWA_NAME} (Free)"
if ! az staticwebapp show -n "$SWA_NAME" -g "$RG" >/dev/null 2>&1; then
  az staticwebapp create -n "$SWA_NAME" -g "$RG" -l "$SWA_LOCATION" --sku Free -o none
fi
SWA_HOST=$(az staticwebapp show -n "$SWA_NAME" -g "$RG" --query defaultHostname -o tsv)
SWA_URL="https://${SWA_HOST}"
ok "$SWA_URL"

say "Application settings on ${API_NAME}"
EXISTING_JWT=$(az webapp config appsettings list -g "$RG" -n "$API_NAME" --query "[?name=='JWT_SECRET'].value | [0]" -o tsv 2>/dev/null || true)
JWT_SECRET="${EXISTING_JWT:-$(openssl rand -base64 48 | tr -d '\n=' | tr '+/' '-_')}"
SETTINGS=(
  APP_BRAND=living-horizon
  "APP_BRAND_NAME=Living Horizon"
  NODE_ENV=production
  PORT=4000
  WEBSITES_PORT=4000
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true
  DATABASE_URL=/home/data/living-horizon.sqlite
  "JWT_SECRET=${JWT_SECRET}"
  JWT_EXPIRES_IN=8h
  "CORS_ORIGIN=${SWA_URL}"
  "PUBLIC_API_BASE=${API_URL}"
  "FRONTEND_POST_LOGIN_URL=${SWA_URL}/index.html"
  "FRONTEND_BASE_URL=${SWA_URL}"
  "BOOTSTRAP_ADMIN_EMAIL=${ADMIN_EMAIL}"
  "BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASSWORD}"
  "BOOTSTRAP_ADMIN_NAME=${ADMIN_NAME}"
  ANTHROPIC_MODEL=claude-sonnet-4-6
  TRAINER_BRAIN_MODEL=claude-haiku-4-5
  RATE_LIMIT_WINDOW_MS=60000
  RATE_LIMIT_MAX=120
  LOG_LEVEL=info
)
[ -n "${ANTHROPIC_API_KEY:-}" ] && SETTINGS+=("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}")
az webapp config appsettings set -g "$RG" -n "$API_NAME" --settings "${SETTINGS[@]}" -o none
az webapp config set -g "$RG" -n "$API_NAME" --always-on true -o none 2>/dev/null || true
az webapp restart -g "$RG" -n "$API_NAME" -o none
ok "set (JWT secret generated; bootstrap admin ${ADMIN_EMAIL})"

say "GitHub secrets and variables on ${REPO}"
SWA_TOKEN=$(az staticwebapp secrets list -n "$SWA_NAME" -g "$RG" --query properties.apiKey -o tsv)
gh secret set AZURE_SWA_API_TOKEN_LIVING_HORIZON --repo "$REPO" --body "$SWA_TOKEN"
az webapp deployment list-publishing-profiles -g "$RG" -n "$API_NAME" --xml > /tmp/lh-publish-profile.xml
gh secret set AZURE_WEBAPP_PUBLISH_PROFILE_LIVING_HORIZON --repo "$REPO" < /tmp/lh-publish-profile.xml
rm -f /tmp/lh-publish-profile.xml
gh variable set LIVING_HORIZON_WEBAPP_NAME --repo "$REPO" --body "$API_NAME"
ok "AZURE_SWA_API_TOKEN_LIVING_HORIZON, AZURE_WEBAPP_PUBLISH_PROFILE_LIVING_HORIZON, LIVING_HORIZON_WEBAPP_NAME"

say "Pointing living-horizon/runtime-config.js at ${API_URL} (one commit to main)"
WORK=$(mktemp -d)
git clone -q --depth 1 "https://github.com/${REPO}.git" "$WORK/repo"
cd "$WORK/repo"
sed -i "s#var LH_API_BASE = 'https://[^']*';#var LH_API_BASE = '${API_URL}';#" living-horizon/runtime-config.js
if git diff --quiet; then
  ok "already pointed at ${API_URL}"
else
  git -c user.name="Living Horizon setup" -c user.email="noreply@livinghorizon.com" commit -qam "Living Horizon: point the portal at ${API_HOST}"
  git push -q origin HEAD:main
  ok "pushed — the living-horizon-swa workflow deploys the portal now"
fi
cd - >/dev/null; rm -rf "$WORK"

say "Deploying"
gh workflow run living-horizon-swa.yml --repo "$REPO" >/dev/null 2>&1 || true
gh workflow run backend.yml --repo "$REPO" >/dev/null 2>&1 || true
ok "workflows started: https://github.com/${REPO}/actions"

say "Waiting for the API to come up"
for i in $(seq 1 40); do
  if curl -fsS "${API_URL}/api/v1/health" 2>/dev/null | grep -q '"brand":"living-horizon"'; then
    ok "healthy: $(curl -fsS "${API_URL}/api/v1/health")"; break
  fi
  sleep 15
  [ "$i" = "40" ] && echo "  still starting — check ${API_URL}/api/v1/health in a few minutes"
done

cat <<DONE

════════════════════════════════════════════════════════════════════
  Living Horizon staff-training portal
    Portal   ${SWA_URL}
    API      ${API_URL}/api/v1/health
    Sign in  ${ADMIN_EMAIL}  /  the ADMIN_PASSWORD you set (you will be asked to change it)

  The portal deploy takes about a minute after the workflow starts.
  Once you are in: remove BOOTSTRAP_ADMIN_PASSWORD from the App Service
  settings, then build your first course from the Admin console.
════════════════════════════════════════════════════════════════════
DONE
