#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# LAD CLPD backend — one-command bootstrap
# ─────────────────────────────────────────────────────────────────────────
# Sets up a clean instance: installs deps, ensures .env exists, runs
# migrations, optionally seeds. Safe to re-run.
#
# Usage:
#   ./scripts/bootstrap.sh                 # install + migrate
#   ./scripts/bootstrap.sh --seed          # ... and seed from data/Blank_data_25.xlsx
#   ./scripts/bootstrap.sh --check         # validate env + DB without changes
set -euo pipefail

cd "$(dirname "$0")/.."

# ─── 1. Env file ────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "✓ Created .env from .env.example — edit it before deploying to production"
  else
    echo "✗ No .env or .env.example found"
    exit 1
  fi
fi

# ─── 2. Node version check ──────────────────────────────────────────────
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo 0)
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "✗ Node 20+ required (you have $(node -v 2>/dev/null || echo 'none'))"
  exit 1
fi

# ─── 3. Install deps ────────────────────────────────────────────────────
if [[ ! -d node_modules ]]; then
  echo "→ Installing dependencies (npm ci)…"
  npm ci --omit=dev --no-audit --no-fund
fi

# ─── 4. Check-only mode ────────────────────────────────────────────────
if [[ "${1:-}" == "--check" ]]; then
  echo "→ Running env validation only…"
  NODE_ENV="${NODE_ENV:-production}" node -e "require('./src/validateEnv').validateEnv()"
  echo "→ Pinging DB…"
  node -e "console.log(require('./src/db').ping() ? '✓ DB OK' : '✗ DB unreachable')"
  exit 0
fi

# ─── 5. Migrations ──────────────────────────────────────────────────────
echo "→ Running migrations…"
node scripts/migrate.js

# ─── 6. Seed (optional) ─────────────────────────────────────────────────
if [[ "${1:-}" == "--seed" ]]; then
  if [[ -f data/Blank_data_25.xlsx ]]; then
    echo "→ Seeding from data/Blank_data_25.xlsx…"
    node scripts/seed.js
  else
    echo "! data/Blank_data_25.xlsx not found — skipping seed. Place the LAD report there and re-run with --seed."
  fi
fi

echo "✓ Bootstrap complete. Start with: npm start"
