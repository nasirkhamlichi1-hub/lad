#!/usr/bin/env bash
# ============================================================================
#  Service Ambassador Academy — one-shot Azure setup
#  Run this in Azure Cloud Shell (Bash):  https://shell.azure.com  (already
#  signed in as you). It provisions everything and configures every setting.
#
#  HOW TO RUN:
#    1. Open https://shell.azure.com  → choose "Bash".
#    2. Upload this file (the {} icon → Upload), or paste its contents.
#    3. Edit the two values in the CONFIG block below (admin password, emails).
#    4. Run:   bash azure-setup.sh
#    5. At the end it prints your site URL and the GitHub deploy token — follow
#       the two "NEXT STEPS" it shows to publish the site.
# ============================================================================
set -euo pipefail

# ----------------------------- CONFIG (edit me) -----------------------------
ADMIN_PASSWORD="CHANGE-ME-admin-pass"      # <- the Trainer Console password (keep it private)
TRAINEE_PASSWORD="Legal@2026"              # <- the shared password trainees sign in with
ALLOWED_EMAILS=""                          # <- optional: "a@x.gov.ae, b@x.gov.ae" (or add people later in the console)

RESOURCE_GROUP="lad-academy-rg"
DATA_REGION="uaenorth"                     # trainee data (table storage) stays in the UAE
SWA_REGION="westeurope"                    # static hosting region (SWA isn't offered in UAE yet)
SWA_NAME="lad-academy"                     # the Static Web App name
# ----------------------------------------------------------------------------

if [ "$ADMIN_PASSWORD" = "CHANGE-ME-admin-pass" ]; then
  echo "✋ Please edit ADMIN_PASSWORD at the top of this script first." ; exit 1
fi

STORAGE_NAME="ladacademy$RANDOM"           # must be globally unique, lowercase, <=24 chars
AUTH_SECRET="$(openssl rand -hex 24)"      # signs login + certificate tokens

echo "▶ Creating resource group ($RESOURCE_GROUP) ..."
az group create -n "$RESOURCE_GROUP" -l "$DATA_REGION" -o none

echo "▶ Creating storage account ($STORAGE_NAME, $DATA_REGION) ..."
az storage account create -n "$STORAGE_NAME" -g "$RESOURCE_GROUP" -l "$DATA_REGION" \
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 -o none
CONN="$(az storage account show-connection-string -n "$STORAGE_NAME" -g "$RESOURCE_GROUP" --query connectionString -o tsv)"

echo "▶ Creating the Static Web App ($SWA_NAME, $SWA_REGION) ..."
az staticwebapp create -n "$SWA_NAME" -g "$RESOURCE_GROUP" -l "$SWA_REGION" --sku Standard -o none

HOST="$(az staticwebapp show -n "$SWA_NAME" -g "$RESOURCE_GROUP" --query defaultHostname -o tsv)"
SITE_URL="https://$HOST"

echo "▶ Applying application settings ..."
az staticwebapp appsettings set -n "$SWA_NAME" -g "$RESOURCE_GROUP" --setting-names \
  TABLES_CONNECTION="$CONN" \
  TRAINEE_PASSWORD="$TRAINEE_PASSWORD" \
  ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  AUTH_SECRET="$AUTH_SECRET" \
  ALLOWED_EMAILS="$ALLOWED_EMAILS" \
  SITE_URL="$SITE_URL" -o none

DEPLOY_TOKEN="$(az staticwebapp secrets list -n "$SWA_NAME" -g "$RESOURCE_GROUP" --query properties.apiKey -o tsv)"

cat <<EOF

============================================================================
✅ Azure is fully provisioned and configured.

   Site URL ......... $SITE_URL
   Trainer Console .. $SITE_URL/admin.html
   Data region ...... $DATA_REGION (UAE)
   Admin password ... (the one you set in this script)
   Shared password .. $TRAINEE_PASSWORD

------------------------------ NEXT STEPS ----------------------------------
1) Publish the site (one time):
   • In GitHub → repo Settings → Secrets and variables → Actions → New secret
       Name:   AZURE_STATIC_WEB_APPS_API_TOKEN_ACADEMY
       Value:  $DEPLOY_TOKEN
   • Then GitHub → Actions → "Azure Static Web Apps CI/CD (Academy)" → Run workflow.
   (After it finishes, open the Site URL above.)

2) (Optional) Point your domain:
   az staticwebapp hostname set -n $SWA_NAME -g $RESOURCE_GROUP \\
     --hostname academy.legalaffairstraining.com
   …then add the CNAME it asks for at your DNS provider.

Keep the deploy token above private. You can re-run step 1's workflow anytime.
============================================================================
EOF
