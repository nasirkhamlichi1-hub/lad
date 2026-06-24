# CLPD Portal — migration to corporate Azure (UAE North)

A step-by-step runbook for moving the CLPD platform from the current hosting
(Render backend + Azure Static Web App frontend) onto the corporate Azure
tenant your IT team has provisioned. Hand this to IT; it is written so they can
start Phase 1 in parallel while the data cutover is scheduled.

> The platform is three movable parts: the **backend container** (Node/Express +
> the SQLite database), the **static frontend**, and the **secrets/config**.
> Code is trivial to move; the **SQLite data file is the one thing we must move
> carefully and never duplicate live.**

---

## 0. Target topology (agreed)

| Part | New home | Notes |
|---|---|---|
| Backend API + data | **Azure App Service (Web App for Containers)**, UAE North — `clpdportal-…uaenorth-01.azurewebsites.net` (or a custom name) | Linux container; **persistent storage attached**; **single instance** (no scale-out) so SQLite file-locking is safe. |
| Frontend (portals) | **New Azure Static Web App** on the corporate tenant | Static HTML/JS from `./frontend`. |
| Secrets/config | App Service → Configuration → Application settings | Never stored in the repo. |
| Custom domain | Chosen by us (IT confirmed we can create the name) | e.g. `clpd.legalaffairs.gov.ae` |

⚠️ **SQLite storage caveat for IT:** `better-sqlite3` needs real persistent storage
with proper file locking. Prefer the App Service's built-in persistent `/home`
storage on a **single instance**. If an Azure Files (SMB) share is used instead,
enable it carefully — SMB can disrupt SQLite WAL locking. Do **not** enable
scale-out / multiple instances while on SQLite.

---

## 1. How the backend image reaches the App Service — pick ONE

The container image is built automatically by GitHub Actions (`.github/workflows/backend.yml`)
and pushed to **GHCR** (`ghcr.io/<owner>/lad-clpd-backend:latest` + `:<sha>`).
There are two ways to get it onto the corporate App Service:

**Option A — App Service pulls the image itself (recommended for a corp/gov tenant).**
IT configures the Web App's Deployment Center to continuously pull the container
from a registry. Two sub-choices:
- Point it straight at the **public GHCR** image (simplest), or
- Mirror the image into the corporate **Azure Container Registry (ACR)** and pull
  from there (keeps everything inside the tenant — usually what gov IT prefers).

*Pros:* no GitHub credential leaves the corporate side; all secrets stay with IT.
*This is the cleaner fit for "everything on corp servers."*

**Option B — GitHub Actions pushes to the App Service.**
IT downloads the App Service **publish profile** (Web App → Get publish profile)
and we store it as the GitHub secret `AZURE_WEBAPP_PUBLISH_PROFILE`, plus set the
repo variable `AZURE_WEBAPP_NAME` to the new app name. Every merge to `main` then
deploys automatically (the workflow is already wired for this).

*Pros:* fully repo-driven CI/CD. *Con:* a deploy credential lives in GitHub.

> Recommendation: **Option A with the image mirrored into corporate ACR.** Tell us
> which you choose and we wire the repo to match.

---

## 2. Phase 1 — Stand up the new backend (no cutover yet)

1. IT creates the App Service (Linux, Web app for Containers, UAE North),
   attaches **persistent storage**, single instance.
2. Wire up image delivery per **§1** (Option A or B).
3. Set **Application settings** (env vars) — full list in **§5**. Critically:
   - `DATABASE_URL=/app/data/lad-clpd.sqlite`
   - a fresh strong `JWT_SECRET` (generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`)
   - `CORS_ORIGIN` = the new frontend URL (fill in once the SWA exists)
   - mount/point the persistent storage so `/app/data` survives restarts.
4. Start it. It auto-runs migrations on boot and seeds an empty DB. Verify:
   ```sh
   curl -fsS https://<new-app>.azurewebsites.net/api/v1/health
   # → {"status":"ok","db":"connected",...}
   ```
   At this point the new backend is live but holds **empty/seed data** — that's
   expected. Real data arrives in Phase 2.

---

## 3. Phase 2 — Move the data (the cutover, ~15 min freeze)

All live data is the single file `lad-clpd.sqlite` (+ its `-wal`/`-shm` siblings)
on the **current** backend's persistent disk.

1. Announce a short maintenance window.
2. **Freeze the old backend** (stop it / set it read-only) so no new writes land
   after you snapshot.
3. Copy the DB off the old host. On the source, a clean, consistent copy is:
   ```sh
   # produces a single consistent file even while WAL exists
   sqlite3 /app/data/lad-clpd.sqlite ".backup '/app/data/clpd-cutover.sqlite'"
   ```
   Download `clpd-cutover.sqlite`.
4. Upload it into the new App Service's persistent storage **as**
   `/app/data/lad-clpd.sqlite` (App Service → Advanced Tools / SSH, or the
   storage share). Make sure there are no stale `-wal`/`-shm` files alongside it.
5. Restart the new App Service. It runs any pending migrations against the real
   data automatically.
6. **Integrity spot-check** before anyone else touches it:
   ```sh
   curl -fsS https://<new-app>.azurewebsites.net/api/v1/health   # db=connected
   # log in as a known user; confirm lawyer counts, a few firms, recent conversations
   ```

---

## 4. Phase 3 — New frontend SWA + repoint

1. IT creates the **new Azure Static Web App** on the corporate tenant, connected
   to this repo, app location `frontend`, no build command (static), publish
   directory `frontend`. (Or upload via the SWA deploy token in `azure-swa.yml`.)
2. **Repoint the frontend at the new backend** — one line in
   `frontend/runtime-config.js`:
   ```js
   window.LAD_API_BASE = 'https://<new-app>.azurewebsites.net';
   ```
   (This is the single source of truth for the API base; we make this change in
   the repo once the final backend URL is fixed.)
3. Set the backend's `CORS_ORIGIN` to the new frontend URL (and custom domain if
   set), then restart the backend.
4. **Custom domain + TLS:** add the chosen hostname to the SWA (and/or the App
   Service), create the DNS records IT provides, and let Azure issue the managed
   certificate.
5. **UAE Pass:** update the registered **redirect URI** whitelist to
   `https://<new-app>.azurewebsites.net/api/v1/auth/uaepass/callback` and set
   `FRONTEND_POST_LOGIN_URL` to the new frontend's `/router.html`.

---

## 5. Application settings to set on the new App Service

From `render.yaml` / `PRODUCTION.md`. Fill the blanks; never commit these.

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | `/app/data/lad-clpd.sqlite` |
| `JWT_SECRET` | **new** strong random (see §2.3) |
| `JWT_EXPIRES_IN` | `8h` |
| `CORS_ORIGIN` | new frontend URL(s), comma-separated |
| `PUBLIC_API_BASE` | `https://<new-app>.azurewebsites.net` |
| `ANTHROPIC_API_KEY` | (Maryam / AI) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |
| `UAEPASS_ENV` | `staging` → `production` once approved |
| `UAEPASS_CLIENT_ID` / `_SECRET` | staging creds |
| `UAEPASS_CLIENT_ID_PROD` / `_SECRET_PROD` | production creds |
| `UAEPASS_REDIRECT_URI` | `https://<new-app>.azurewebsites.net/api/v1/auth/uaepass/callback` |
| `FRONTEND_POST_LOGIN_URL` | `https://<frontend>/router.html` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `120` |
| `LOG_LEVEL` | `info` |

Optional (AI Trainer): `ANAM_API_KEY`, `ANAM_AVATAR_ID`, `ANAM_VOICE_ID`,
`MORPHCAST_LICENSE_KEY`.

---

## 6. Phase 4 — Verify, watch, decommission

1. Full smoke test: log in for each role (lawyer, firm CO, LAD admin, super
   admin), make a booking, send a message, confirm Maryam replies, open the CRM
   inbox + Command Centre.
2. Leave the **old Render backend parked (frozen) for ~24–48h** as instant
   rollback.
3. Turn on monitoring: alert on `/api/v1/health` != 200 for >2 min, and on
   `level=error` rate spikes. Schedule a daily DB backup
   (`sqlite3 … ".backup"` to a separate share).
4. Once stable, decommission the old Render service and the old SWA.

---

## 7. Rollback

At any point before decommissioning, rollback is just repointing
`frontend/runtime-config.js` `LAD_API_BASE` back to the old Render URL and
redeploying the frontend — the old stack is untouched until Phase 4. To roll back
a bad backend image, re-tag a previous `:<sha>` as `:latest` and let the App
Service re-pull (see `PRODUCTION.md` §6).

---

## What we need from IT to finalise the repo wiring

- [ ] Final **backend App Service name** (and whether Option A or B in §1).
- [ ] If Option B: the **publish profile** (we add it as a GitHub secret).
- [ ] New **Static Web App** deploy token (for `azure-swa.yml`) or confirmation
      they'll connect the repo directly.
- [ ] The chosen **custom domain** + the DNS records they'll create.

Give us these and we will: repoint `runtime-config.js`, update `backend.yml` /
`azure-swa.yml` to the new resources, refresh `CORS_ORIGIN` + UAE Pass docs, and
confirm a green end-to-end run.
