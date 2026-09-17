#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────
# Container entrypoint — what runs when the image starts.
# ─────────────────────────────────────────────────────────────────────────
# Zero-downtime boot: apply schema migrations (fast), then START THE SERVER
# IMMEDIATELY so the health check passes within ~2s and a rolling deploy
# never drops traffic. Seeding runs in the BACKGROUND (own process, so it
# cannot block the event loop). SQLite WAL + busy_timeout lets the seed and
# the live server share the file safely.
#
# What gets seeded depends on APP_BRAND (src/brand.js):
#   lad             — the CLPD dataset: roster, feedback, accredited
#                     catalogue, knowledge hubs, FAQ, firm de-duplication.
#   living-horizon, freelance — none of that. The instance starts empty apart from the
#                     bootstrap admin (scripts/ensure-admin.js), and any LAD
#                     demo sign-ins are switched off (scripts/harden-brand.js).
set -u
cd "$(dirname "$0")/.."

node scripts/migrate.js || true

BRAND="${APP_BRAND:-lad}"
{
  node scripts/ensure-admin.js
  if [ "$BRAND" = "lad" ]; then
    node scripts/seed-if-needed.js
    node scripts/seed-feedback.js
    node scripts/seed-accredited.js
    node scripts/seed-hubs.js
    node scripts/seed-faq.js
    node scripts/dedupe-firms.js
  else
    node scripts/harden-brand.js
  fi
} &

exec node src/server.js
