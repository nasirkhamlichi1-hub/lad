#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Freelance lawyers portal — create everything on Azure and wire it to GitHub, once.
# ─────────────────────────────────────────────────────────────────────────
# Run this in Azure CLOUD SHELL (the >_ icon at the top of portal.azure.com,
# Bash mode). Cloud Shell already has `az` signed in as you and `gh` installed.
#
#   curl -fsSL https://raw.githubusercontent.com/nasirkhamlichi1-hub/lad/main/docs/azure-freelance.sh -o fl.sh
#   ADMIN_EMAIL=you@legal.dubai.gov.ae ADMIN_PASSWORD='Choose-A-Temp-Pass-1' bash fl.sh
#
# What it does (idempotent — safe to re-run):
#   1. In the CLPD resource group: a Linux App Service plan (B1) and a Web App
#      for Containers running ghcr.io/<owner>/lad-clpd-backend:latest with
#      APP_BRAND=freelance, persistent storage, and every application setting
#      from docs/FREELANCE.md.
#   2. A Static Web App for the portal (freelance/), with the custom domain
#      freelance.legalaffairstraining.com: a CNAME in the Azure DNS zone and the
#      hostname on the Static Web App (it validates once the zone is live at the
#      registrar — see docs/FREELANCE.md §3).
#   3. GitHub: stores the SWA deploy token and the App Service publish profile as
#      repo secrets, sets FREELANCE_WEBAPP_NAME, points runtime-config.js at
#      the new API (one commit to main), and runs both deploy workflows.
#   4. Waits for the API to answer with brand=freelance and prints the URLs.
#
# Variables you may override (defaults in brackets):
#   ADMIN_EMAIL, ADMIN_PASSWORD   the first super admin (required; password 8+ chars)
#   ADMIN_NAME                    ["Training Administrator"]
#   ELEVENLABS_API_KEY            the trainer's voice (optional; browser voice otherwise)
#   ANTHROPIC_API_KEY             the AI trainer's brain and AI drafting (optional)
#   LOCATION                      [uaenorth]
#   RG                            [clpd-prod]   (the CLPD resource group, where the DNS zone lives)
#   API_NAME                      [lad-freelance-api]   (must be globally unique)
#   SWA_NAME                      [clpd-freelance]
#   DOMAIN / SUBDOMAIN            [legalaffairstraining.com] / [freelance]
#   REPO                          [nasirkhamlichi1-hub/lad]
#   GHCR_USER / GHCR_TOKEN        only if the GHCR package is private (a GitHub PAT with read:packages)
set -euo pipefail

: "${ADMIN_EMAIL:?Set ADMIN_EMAIL=you@legal.dubai.gov.ae}"
: "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD='a temporary password (8+ chars)'}"
ADMIN_NAME="${ADMIN_NAME:-Training Administrator}"
LOCATION="${LOCATION:-uaenorth}"
RG="${RG:-clpd-prod}"
PLAN="${PLAN:-plan-freelance}"
API_NAME="${API_NAME:-lad-freelance-api}"
SWA_NAME="${SWA_NAME:-clpd-freelance}"
DOMAIN="${DOMAIN:-legalaffairstraining.com}"
SUBDOMAIN="${SUBDOMAIN:-freelance}"
PORTAL_URL="https://${SUBDOMAIN}.${DOMAIN}"
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

say "Making sure the backend image on GHCR already carries the freelance brand"
MAIN_SHA=$(gh api "repos/${REPO}/commits/main" --jq .sha)
BUILT=$(gh run list --repo "$REPO" --workflow backend.yml --branch main --status success --limit 5 --json headSha --jq '.[].headSha' | grep -c "$MAIN_SHA" || true)
if [ "$BUILT" = "0" ]; then
  echo "The backend image for main@${MAIN_SHA:0:7} has not finished building yet."
  echo "Wait for the 'backend' workflow at https://github.com/${REPO}/actions to go green, then re-run this script."
  echo "(Starting the App Service on an older image would apply the LAD data to the new database.)"
  exit 1
fi
ok "image for main@${MAIN_SHA:0:7} is built"

say "Resource group ${RG}"
if az group show -n "$RG" >/dev/null 2>&1; then
  ok "exists (the CLPD resource group)"
else
  az group create -n "$RG" -l "$LOCATION" -o none
  ok "created in ${LOCATION}"
fi

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

say "Subdomain ${SUBDOMAIN}.${DOMAIN} → ${SWA_HOST}"
if az network dns zone show -g "$RG" -n "$DOMAIN" >/dev/null 2>&1; then
  az network dns record-set cname set-record -g "$RG" -z "$DOMAIN" -n "$SUBDOMAIN" -c "$SWA_HOST" --ttl 3600 -o none
  ok "CNAME ${SUBDOMAIN} → ${SWA_HOST} in the Azure DNS zone"
  if az staticwebapp hostname show -n "$SWA_NAME" -g "$RG" --hostname "${SUBDOMAIN}.${DOMAIN}" >/dev/null 2>&1; then
    ok "hostname already on the Static Web App"
  else
    # Validation needs the CNAME to resolve publicly; if the zone is not yet
    # live at the registrar this returns an error but leaves the request pending.
    az staticwebapp hostname set -n "$SWA_NAME" -g "$RG" --hostname "${SUBDOMAIN}.${DOMAIN}" --no-wait -o none 2>/dev/null \
      && ok "hostname requested — validates once ${DOMAIN} resolves from the Azure zone (registrar nameservers)" \
      || echo "  ! could not add the hostname yet — re-run this script once the domain's nameservers point at Azure DNS"
  fi
else
  echo "  ! no DNS zone ${DOMAIN} in ${RG} — add the CNAME ${SUBDOMAIN} → ${SWA_HOST} at your DNS host, then:"
  echo "    az staticwebapp hostname set -n ${SWA_NAME} -g ${RG} --hostname ${SUBDOMAIN}.${DOMAIN}"
fi

say "Application settings on ${API_NAME}"
EXISTING_JWT=$(az webapp config appsettings list -g "$RG" -n "$API_NAME" --query "[?name=='JWT_SECRET'].value | [0]" -o tsv 2>/dev/null || true)
JWT_SECRET="${EXISTING_JWT:-$(openssl rand -base64 48 | tr -d '\n=' | tr '+/' '-_')}"
SETTINGS=(
  APP_BRAND=freelance
  NODE_ENV=production
  PORT=4000
  WEBSITES_PORT=4000
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true
  DATABASE_URL=/home/data/freelance.sqlite
  "JWT_SECRET=${JWT_SECRET}"
  JWT_EXPIRES_IN=8h
  "CORS_ORIGIN=${PORTAL_URL},${SWA_URL}"
  "PUBLIC_API_BASE=${API_URL}"
  "FRONTEND_POST_LOGIN_URL=${PORTAL_URL}/index.html"
  "FRONTEND_BASE_URL=${PORTAL_URL}"
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
[ -n "${ELEVENLABS_API_KEY:-}" ] && SETTINGS+=("ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}")
az webapp config appsettings set -g "$RG" -n "$API_NAME" --settings "${SETTINGS[@]}" -o none
az webapp config set -g "$RG" -n "$API_NAME" --always-on true -o none 2>/dev/null || true
az webapp restart -g "$RG" -n "$API_NAME" -o none
ok "set (JWT secret generated; bootstrap admin ${ADMIN_EMAIL})"

say "GitHub secrets and variables on ${REPO}"
SWA_TOKEN=$(az staticwebapp secrets list -n "$SWA_NAME" -g "$RG" --query properties.apiKey -o tsv)
gh secret set AZURE_SWA_API_TOKEN_FREELANCE --repo "$REPO" --body "$SWA_TOKEN"
az webapp deployment list-publishing-profiles -g "$RG" -n "$API_NAME" --xml > /tmp/fl-publish-profile.xml
gh secret set AZURE_WEBAPP_PUBLISH_PROFILE_FREELANCE --repo "$REPO" < /tmp/fl-publish-profile.xml
rm -f /tmp/fl-publish-profile.xml
gh variable set FREELANCE_WEBAPP_NAME --repo "$REPO" --body "$API_NAME"
ok "AZURE_SWA_API_TOKEN_FREELANCE, AZURE_WEBAPP_PUBLISH_PROFILE_FREELANCE, FREELANCE_WEBAPP_NAME"

say "Pointing freelance/runtime-config.js at ${API_URL} (one commit to main)"
WORK=$(mktemp -d)
git clone -q --depth 1 "https://github.com/${REPO}.git" "$WORK/repo"
cd "$WORK/repo"
sed -i "s#var FL_API_BASE = 'https://[^']*';#var FL_API_BASE = '${API_URL}';#" freelance/runtime-config.js
if git diff --quiet; then
  ok "already pointed at ${API_URL}"
else
  git -c user.name="Freelance portal setup" -c user.email="noreply@legalaffairstraining.com" commit -qam "Freelance lawyers: point the portal at ${API_HOST}"
  git push -q origin HEAD:main
  ok "pushed — the freelance-swa workflow deploys the portal now"
fi
cd - >/dev/null; rm -rf "$WORK"

say "Deploying"
gh workflow run freelance-swa.yml --repo "$REPO" >/dev/null 2>&1 || true
gh workflow run backend.yml --repo "$REPO" >/dev/null 2>&1 || true
ok "workflows started: https://github.com/${REPO}/actions"

say "Waiting for the API to come up"
for i in $(seq 1 40); do
  if curl -fsS "${API_URL}/api/v1/health" 2>/dev/null | grep -q '"brand":"freelance"'; then
    ok "healthy: $(curl -fsS "${API_URL}/api/v1/health")"; break
  fi
  sleep 15
  [ "$i" = "40" ] && echo "  still starting — check ${API_URL}/api/v1/health in a few minutes"
done

cat <<DONE

════════════════════════════════════════════════════════════════════
  Freelance lawyers training portal — Legal Affairs Department
    Portal   ${PORTAL_URL}   (until the domain is live: ${SWA_URL})
    API      ${API_URL}/api/v1/health
    Sign in  ${ADMIN_EMAIL}  /  the ADMIN_PASSWORD you set (you will be asked to change it)

  The portal deploy takes about a minute after the workflow starts.
  Once you are in: remove BOOTSTRAP_ADMIN_PASSWORD from the App Service
  settings, then build your first course from the Admin console.
════════════════════════════════════════════════════════════════════
DONE
