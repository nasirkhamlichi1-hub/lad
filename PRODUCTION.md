# LAD CLPD — production deployment runbook

This is the one document to follow when taking the platform live. Everything
that can be automated is. The remaining manual steps are listed below in the
order you should do them.

---

## Table of contents

1. [What's automated and what isn't](#1-whats-automated-and-what-isnt)
2. [Irreducible manual steps (do these first)](#2-irreducible-manual-steps-do-these-first)
3. [Deploying — the actual commands](#3-deploying--the-actual-commands)
4. [Day-1 verification](#4-day-1-verification)
5. [Ongoing operations](#5-ongoing-operations)
6. [Rollback / disaster recovery](#6-rollback--disaster-recovery)
7. [Production-readiness checklist](#7-production-readiness-checklist)
8. [Known limitations](#8-known-limitations)

---

## 1. What's automated and what isn't

### Automated

| Concern | Mechanism |
|---|---|
| Backend image build | `.github/workflows/backend.yml` → push to `ghcr.io/<owner>/lad-clpd-backend:latest` on every push to `main` |
| Frontend deploy | `.github/workflows/azure-swa.yml` → Azure Static Web Apps deploy on every commit to `main` |
| Schema migrations | `node scripts/migrate.js` runs automatically in the container's `CMD` before the server boots |
| Env validation | `src/validateEnv.js` runs at boot — refuses to start in production with default/insecure values |
| Graceful shutdown | SIGTERM handler drains in-flight HTTP and closes the DB before exiting |
| Health checks | `/api/v1/health` — wired into the Dockerfile HEALTHCHECK, Render `healthCheckPath`, and Azure liveness probes |
| Request correlation | Every request gets an `X-Request-Id` echoed back in headers and embedded in logs and error responses |
| Structured logging | JSON one-liner per request in production; pretty single-line in development |
| Rate limiting | 120 req/min/IP by default (`RATE_LIMIT_MAX`), with UAE Pass callback excluded |
| HTTPS | Provider-managed (Azure, Render) — automatic free certificates |
| Security headers | Helmet on the API; CSP/HSTS/Permissions-Policy on the static host |

### Not automated — these need a person

| Step | Who | Approx time | Why it can't be automated |
|---|---|---|---|
| Register UAE Pass Service Provider | LAD | 2–6 weeks | UAE government onboarding; involves signed agreements + security review |
| Domain registration on `.ae` | LAD / IT | 1 hour | Procurement + payment |
| DNS records (A/CNAME to Azure + Render) | IT | 30 min + propagation | Registrar-specific UI |
| Cloud account creation (Render or Azure) | IT | 30 min | Account + billing setup |
| Paste secrets into cloud dashboards | IT | 15 min | Secret values shouldn't transit through CI |
| Anthropic API key | Engineering | 5 min | Sign up at console.anthropic.com, generate, paste |
| Email provider signup (Postmark/SES) | Engineering | 30 min | Domain verification step |
| Approve `Blank_data_25.xlsx` for production use | LAD legal | varies | Real PII |
| Data Protection Impact Assessment | LAD legal | varies | Mandatory for government processing of PII |

---

## 2. Irreducible manual steps (do these first)

Do these in order. None depends on code; you can start before any deploy.

### 2.1 UAE Pass Service Provider onboarding
1. Submit SP registration at https://uaepass.ae/ for both **staging** and **production** environments.
2. Provide:
   - The production callback URL: `https://api.<your-domain>.ae/api/v1/auth/uaepass/callback`
   - The post-logout URL: `https://<your-domain>.ae/`
   - Required scopes: `urn:uae:digitalid:profile:general`
   - Authentication level: start with `low` ACR, request `high` once approved
3. Wait for the staging credentials email (typically days). Production credentials come after a security review (weeks).
4. Save both pairs in your password manager — never commit, never paste in chat.

### 2.2 Domain + DNS
1. Register `<your-domain>.ae` (or use an existing LAD subdomain).
2. DNS records:
   - `<your-domain>.ae` → Azure Static Web Apps (frontend) — add the custom domain in the Azure SWA portal and point a CNAME at the provided host.
   - `api.<your-domain>.ae` → backend host (Render or Azure) — CNAME to the host's domain.
3. Wait for propagation (5 min – 24 h).
4. SSL is auto-issued by Azure Static Web Apps and Render (managed certificates).

### 2.3 Cloud account + secrets
1. Create a Render account (recommended for staging) **or** Azure subscription (recommended for UAE production — UAE North region for data residency).
2. Connect the GitHub repo to the cloud provider.
3. Generate the production `JWT_SECRET`:
   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   Paste into the cloud dashboard's env-var section.
4. Paste the UAE Pass staging + production credentials.
5. Paste the Anthropic API key (optional — Lex panel returns 503 without it).

### 2.4 Initial seed data
1. Place `Blank_data_25.xlsx` (the LAD-supplied report) into `backend/data/` **only on the deploying machine** — do **not** commit it. The seed script reads it once, persists the rows to SQLite, and the file can then be deleted.
2. Run `npm run seed` once via the cloud's shell / SSH access, or run it locally and copy the resulting `lad-clpd.sqlite` into the persistent volume on first deploy.

---

## 3. Deploying — the actual commands

### 3.1 First-time backend deploy (Render — easiest path)

```sh
# In the repo root, push render.yaml to GitHub:
git add render.yaml && git commit -m "Add Render blueprint" && git push

# In the Render dashboard:
#   1. New → Blueprint → connect this repo
#   2. Render reads render.yaml, provisions the web service + 1 GB disk
#   3. Fill in the `sync: false` env vars in the dashboard (see render.yaml for the list)
#   4. Click "Apply"

# After ~3 min the service is live. Verify:
curl https://lad-clpd-backend.onrender.com/api/v1/health
# → {"status":"ok",...}
```

### 3.2 First-time backend deploy (Azure Container Apps — production path)

The same Docker image works. From a Cloud Shell session:

```sh
# Pull the GHCR image (image name from .github/workflows/backend.yml)
az containerapp create \
  --name lad-clpd-backend \
  --resource-group <rg> \
  --image ghcr.io/<owner>/lad-clpd-backend:latest \
  --target-port 4000 \
  --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --cpu 0.5 --memory 1.0Gi \
  --env-vars \
    NODE_ENV=production \
    PORT=4000 \
    LOG_LEVEL=info \
    JWT_SECRET=<paste> \
    UAEPASS_ENV=production \
    UAEPASS_CLIENT_ID_PROD=<paste> \
    UAEPASS_CLIENT_SECRET_PROD=<paste> \
    CORS_ORIGIN=https://<your-domain>.ae \
    DATABASE_URL=/app/data/lad-clpd.sqlite \
    ANTHROPIC_API_KEY=<paste>

# Attach a persistent volume (Azure Files share) so the SQLite file survives restarts
# — see Azure docs for `az containerapp env storage` and `--volume-mount`.
```

For multi-instance production, replace SQLite with Azure Database for PostgreSQL Flexible Server (UAE North). The codebase uses prepared statements throughout, so the swap is a `db.js` rewrite — keep this in mind once concurrent writers become a bottleneck.

### 3.3 First-time frontend deploy (Azure Static Web Apps)

```sh
# Option A — drag-and-drop (one-off):
#   1. Push to `main` — the azure-swa workflow deploys ./frontend automatically
#   2. Drag the frontend folder

# Option B — connected to GitHub (auto-deploy on every push):
#   1. In Azure: create a Static Web App → connect this repo → app location ./frontend
#   2. Build settings:
#      - Base directory: frontend
#      - Build command: (leave blank — static)
#      - Publish directory: frontend
#   3. Site settings → Environment variables: (none needed)
#   4. Deploys → "Deploy site"
```

After the first deploy:

1. Edit `frontend/runtime-config.js` and set `window.LAD_API_BASE = 'https://api.<your-domain>.ae';`
2. Commit and push. GitHub Actions auto-deploys.

### 3.4 GitHub Actions secrets

In the repo's **Settings → Secrets and variables → Actions**, add:

| Secret | Where to get it |
|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Azure SWA → Manage deployment token |


That's it for CI. The backend's container push uses the built-in `GITHUB_TOKEN` — no setup needed.

---

## 4. Day-1 verification

After both backend and frontend are live, walk through this once:

```sh
# Backend health
curl -fsS https://api.<your-domain>.ae/api/v1/health
# Expect: status=ok, db=connected

# Backend version
curl -fsS https://api.<your-domain>.ae/api/v1/version
# Expect: name=lad-clpd-backend, env=production

# Composite config (read-only, no auth)
curl -fsS https://api.<your-domain>.ae/api/v1/config | jq '. | keys'
# Expect: courses, content, faq, stats, version, generated
```

In the browser:

1. Visit `https://<your-domain>.ae` — public landing loads, no console errors.
2. DevTools → Network — confirm `runtime-config.js` is requested and `window.LAD_ENV === 'production'` in the console.
3. Click **Sign in → Lawyer → UAE Pass → Sign in with UAE Pass** — full OAuth round-trip should complete.
4. Click **Sign in → LAD Staff → Continue → any email/password → Sign in** — lands on `/lad-intelligence-v4.html`.
5. From the LAD Staff page, drag a slider in the Forecast simulator — the Trajectory chart should re-render in real time.
6. Sign out from any portal — should land back on the public landing.

If all six pass, you're live.

---

## 5. Ongoing operations

### 5.1 Deploying changes

Default flow: edit code on a feature branch, open a PR, merge to `main`.

- Backend changes → `.github/workflows/backend.yml` builds and pushes a new image. Render/Azure auto-pulls on next deploy.
- Frontend changes → `.github/workflows/azure-swa.yml` deploys to Azure Static Web Apps.
- Schema changes → add a new file to `backend/migrations/` (e.g. `002-add-thing.sql`); it'll be applied automatically by the container's startup command.

### 5.2 Database backups

SQLite + persistent disk strategy:

- **Render**: snapshots the disk daily (Standard plan and above). Manual snapshots via dashboard.
- **Azure**: configure Azure Files snapshots or a cron'd `cp lad-clpd.sqlite lad-clpd.sqlite.$(date +%Y%m%d)` into a separate Files share.

When you move to PostgreSQL, both providers offer point-in-time recovery — turn it on.

### 5.3 Monitoring

The app produces JSON logs that any aggregator can pick up:

- **Render**: native log stream + log drains to Logtail/Papertrail/Datadog.
- **Azure**: Container Apps emits to Log Analytics by default — query with KQL.

Set up two alerts at minimum:

1. `/api/v1/health` returning anything other than 200 for > 2 min → page on-call.
2. `level=error` rate > 1/min for > 5 min → investigate.

### 5.4 Rotating secrets

Rotate `JWT_SECRET` quarterly:

1. Update the env var in the cloud dashboard.
2. Restart the container.
3. All sessions are invalidated; users sign in again. (This is expected behaviour.)

UAE Pass credentials rotate per the agreement with the provider — typically yearly.

---

## 6. Rollback / disaster recovery

### 6.1 Roll back a deploy

```sh
# Backend — re-tag a previous image to :latest, redeploy
docker pull ghcr.io/<owner>/lad-clpd-backend:<previous-sha>
docker tag  ghcr.io/<owner>/lad-clpd-backend:<previous-sha> ghcr.io/<owner>/lad-clpd-backend:latest
docker push ghcr.io/<owner>/lad-clpd-backend:latest
# Render/Azure picks up the new :latest on next deploy.

# Frontend — Azure Static Web Apps keeps deploy history; roll back from the SWA portal or re-run the workflow on a prior commit.
```

### 6.2 Restore the database

```sh
# Pause the service first to prevent writes
# Restore the SQLite file from the snapshot
# Restart
```

### 6.3 Full DR (cloud provider outage)

The image is in GHCR (region-independent). Stand up a new container service on a different provider using the same image and the same env vars. Restore the database from the most recent snapshot. Update DNS to point at the new origin.

Recovery time objective (RTO) with this setup: ≈ 30 min for compute, plus DNS propagation.

---

## 7. Production-readiness checklist

Before flipping DNS to point at production:

### Code & infrastructure (automated checks)
- [x] Env validation refuses dev secrets in production (`src/validateEnv.js`)
- [x] Graceful shutdown on SIGTERM
- [x] Health check endpoint
- [x] Rate limiting
- [x] CORS allowlist (no `*`)
- [x] Helmet security headers on API
- [x] CSP/HSTS/Permissions-Policy on frontend
- [x] Structured JSON logs in production
- [x] Request IDs propagated
- [x] Non-root container user
- [x] Multi-stage Dockerfile (smaller, no build toolchain)
- [x] Migrations runner

### Operations (manual, do once per environment)
- [ ] JWT_SECRET generated and pasted (not the default)
- [ ] UAE Pass staging credentials configured + tested
- [ ] UAE Pass production credentials configured (after SP approval)
- [ ] UAEPASS_REDIRECT_URI uses HTTPS in production
- [ ] CORS_ORIGIN set to exact frontend domain(s), no wildcards
- [ ] Database persistent volume mounted at `/app/data`
- [ ] Database backups configured (snapshot policy)
- [ ] Frontend `runtime-config.js` points at the production API
- [ ] DNS records resolve
- [ ] SSL certificates valid for both frontend and API domains
- [ ] GitHub Actions secrets set (`AZURE_STATIC_WEB_APPS_API_TOKEN`)
- [ ] At least one rollback drill performed

### Legal / compliance (manual, not in this repo's scope)
- [ ] Data Protection Impact Assessment complete
- [ ] `Blank_data_25.xlsx` seed-data approved by LAD legal
- [ ] Privacy policy + terms published on the public landing
- [ ] UAE Pass agreement signed
- [ ] Hosting provider sub-processor agreement signed (if government data crosses borders)

---

## 8. Known limitations

These are honest gaps to be aware of:

- **No multi-instance write coordination.** SQLite is single-writer. Run one backend instance until you migrate to Postgres. Render's `min-replicas`/`max-replicas` are pinned to 1 by default for this reason.
- **No email integration.** Booking confirmations, password resets, and exemption-request acknowledgements are toast notifications only. Add Postmark/SES integration before launch if these flows are required.
- **No automated tests.** The CI smoke-test boots the server and hits `/health`. Unit and integration tests would catch regressions earlier — recommended before scaling out the team.
- **No metrics endpoint.** Logs work for observability but `/metrics` (Prometheus) is not implemented. Add `prom-client` if you adopt Prometheus.
- **No CSRF protection on staff login.** The `/api/v1/auth/staff/login` endpoint accepts email+password without a CSRF token. Acceptable because it returns a JWT (not a cookie) and uses CORS allowlist, but add a token if you switch to cookie-based sessions.
- **Lex AI panel calls Anthropic from the server.** Costs accrue per call. If usage grows, add a per-user quota in the database before launch.
