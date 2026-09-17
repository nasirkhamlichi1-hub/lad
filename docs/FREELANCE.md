# Freelance lawyers training portal — runbook

The Department's training portal for its freelance lawyers, at
**freelance.legalaffairstraining.com**. It is the CLPD platform's engine (the
learning spine, the SCORM player, the reference library, the AI trainer) cut
down to what a small cohort needs, deployed as its own site with its own
database. No credits (every course is free), no firms or compliance officers,
no accredited-provider catalogue, no CLPD hours. A lawyer signs in with the
email and password the Department gave them, sees the courses assigned to
them, and their progress is saved so they come back to exactly where they
stopped. The interface is in English and Arabic.

> One codebase, one container image, a third deployment. `APP_BRAND=freelance`
> turns the backend into the freelance-lawyers instance; the `freelance/`
> folder is its front end. The CLPD deployment (www.legalaffairstraining.com)
> and the Living Horizon one are untouched.

---

## 1. What it is made of

| Part | Where | Hosted on |
|---|---|---|
| Front end (the portal) | `freelance/` | Azure **Static Web App** `clpd-freelance` in the `clpd-prod` resource group, custom domain `freelance.legalaffairstraining.com` |
| Backend API + database | `backend/` (the existing image, `APP_BRAND=freelance`) | Azure **App Service, Web App for Containers** `lad-freelance-api`, single instance, persistent `/home` storage |
| Image build | `.github/workflows/backend.yml` | GitHub Actions → `ghcr.io/<owner>/lad-clpd-backend:latest` |
| Portal deploy | `.github/workflows/freelance-swa.yml` | GitHub Actions → the Static Web App, on every push to `main` that touches `freelance/` |
| DNS | Azure DNS zone `legalaffairstraining.com` in `clpd-prod` | `freelance` CNAME → the Static Web App |

What a freelance lawyer gets:

- **Sign in** with email and password (`index.html`). First sign-in forces a password change; *Forgotten your password?* emails a reset link.
- **My training** (`home.html`): courses assigned to them, courses they started, everything else published, with progress on each and a "pick up where you left off" card.
- **A course** (`course.html`): the welcome, the pathway of steps in order (or any order), and the reference library. A step is one of:
  - an **e-learning module** — a SCORM package played inside the page; the package's own status and score complete the step and its bookmark is saved so it resumes;
  - a **reference document** — a PDF/Word file or a link (a law on legal.dubai.gov.ae, for instance), opened in the page and marked as read;
  - an **AI trainer session** — a one-to-one conversation (voice or typing) that teaches from the document the admin uploaded and does not finish until every key element is understood.
- **Arabic** — the switch on the Government bar; the whole interface flips to right-to-left in the Dubai font. Course content is shown as the admin wrote it.

What a training administrator gets (`admin.html`, the same console as the CLPD platform's learning admin, with the lawyer-account tab):

- **Courses** — create a course, add steps in any order, upload the SCORM zip, attach reference documents, teach the AI trainer from a document, set a photo and colour, publish.
- **Learners & progress** — every course and who is on it; each lawyer's full record (print / CSV); assign a course to named lawyers or to **everyone**.
- **Overview** — completion rate, hours, who has gone quiet, where people get stuck.
- **Lawyer accounts** — add freelance lawyers (name, email, licence number) and admins, reset passwords, suspend.

---

## 2a. The short way: one script in Azure Cloud Shell

`docs/azure-freelance.sh` does §2, §3 and the GitHub wiring in one go. Open
Cloud Shell (the `>_` icon at the top of portal.azure.com, Bash) and run:

```sh
curl -fsSL https://raw.githubusercontent.com/nasirkhamlichi1-hub/lad/main/docs/azure-freelance.sh -o fl.sh
ADMIN_EMAIL=you@legal.dubai.gov.ae ADMIN_PASSWORD='Choose-A-Temp-Pass-1' bash fl.sh
# optional: ANTHROPIC_API_KEY=sk-ant-… for the AI trainer's brain
#           ELEVENLABS_API_KEY=…      for the trainer's voice
```

It creates the App Service plan and Web App in `clpd-prod`, the Static Web
App, the `freelance` CNAME in the Azure DNS zone and the custom hostname on
the Static Web App, all application settings, stores the deploy token and
publish profile as GitHub secrets, points `runtime-config.js` at the new API,
runs both workflows, and prints the URLs and your first sign-in. Safe to
re-run. The manual steps below are the same thing by hand.

> The custom domain only validates once `legalaffairstraining.com` is served
> from the Azure DNS zone — i.e. once the registrar's nameservers are the
> `ns1-06.azure-dns.com` … `ns4-06.azure-dns.info` set. Until then the portal
> is reachable at the Static Web App's own `*.azurestaticapps.net` address,
> which the script prints and which is already in the backend's `CORS_ORIGIN`.

## 2. Stand up the backend (Azure App Service)

1. **Create the Web App** in `clpd-prod` — Linux, *Web App for Containers*, one
   instance (SQLite is single-writer; do not scale out). Name: `lad-freelance-api`.
2. **Point it at the image.** Deployment Center → Container registry → **GHCR**,
   image `ghcr.io/<owner>/lad-clpd-backend`, tag `latest`, continuous deployment
   on. Alternatively let GitHub push it: download the app's *publish profile* and
   add it as the repo secret `AZURE_WEBAPP_PUBLISH_PROFILE_FREELANCE` and the repo
   variable `FREELANCE_WEBAPP_NAME`; the `deploy-freelance` job in `backend.yml`
   then deploys on every push to `main`.
3. **Persistent storage.** Configuration → General settings → *App Service storage*:
   **On**. The database lives at `/home/data/freelance.sqlite`.
4. **Application settings**:

   | Setting | Value |
   |---|---|
   | `APP_BRAND` | `freelance` |
   | `NODE_ENV` | `production` |
   | `PORT` / `WEBSITES_PORT` | `4000` / `4000` |
   | `DATABASE_URL` | `/home/data/freelance.sqlite` |
   | `JWT_SECRET` | a fresh random value — never the CLPD instance's |
   | `JWT_EXPIRES_IN` | `8h` |
   | `CORS_ORIGIN` | `https://freelance.legalaffairstraining.com,https://<swa-host>.azurestaticapps.net` — also lets the portal frame the SCORM player |
   | `PUBLIC_API_BASE` | `https://lad-freelance-api.azurewebsites.net` |
   | `FRONTEND_POST_LOGIN_URL` | `https://freelance.legalaffairstraining.com/index.html` (required by the boot check; UAE Pass is not used) |
   | `FRONTEND_BASE_URL` | `https://freelance.legalaffairstraining.com` (password-reset links are built from it) |
   | `BOOTSTRAP_ADMIN_EMAIL` | your email — creates the first super admin on boot if it does not exist |
   | `BOOTSTRAP_ADMIN_PASSWORD` | a temporary password (8+ chars); you are made to change it on first sign-in. Remove this setting once you are in. |
   | `BOOTSTRAP_ADMIN_NAME` | `First Last` (optional) |
   | `ANTHROPIC_API_KEY` | for the AI trainer's brain and AI drafting (optional — a scripted fallback otherwise). Use a key of its own, not the CLPD one, so it can be revoked separately. |
   | `ANTHROPIC_MODEL` / `TRAINER_BRAIN_MODEL` | `claude-sonnet-4-6` / `claude-haiku-4-5` |
   | `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | optional — the trainer's voice; browser voice otherwise |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | password-reset and assignment emails; queued but unsent without them |
   | `AZURE_STORAGE_CONNECTION_STRING` | optional — SCORM packages and documents over 10 MB go to Blob storage |
   | `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `120` |

5. **Start it** and check:
   ```sh
   curl -fsS https://lad-freelance-api.azurewebsites.net/api/v1/health
   # → {"status":"ok","service":"lad-freelance-backend","brand":"freelance",...}
   curl -fsS https://lad-freelance-api.azurewebsites.net/api/v1/brand
   # → {"id":"freelance","programme":"Freelance Lawyers Training","learner_kind":"lawyer","firms":false,...}
   ```
   On boot the container runs the schema migrations (skipping every LAD data
   migration — no Dubai lawyer roll, no demo sign-ins, no 2025 CLPD schedule),
   creates the bootstrap admin, and suspends any CLPD test account that might
   have come in with a copied database. The instance starts empty.

---

## 3. Stand up the portal (Azure Static Web App) and the subdomain

1. **Create a Static Web App** `clpd-freelance` in `clpd-prod` (Static Web Apps
   are not offered in UAE North; West Europe is fine — it is a CDN). Plan: Free.
   Deployment source: *Other*.
2. Copy its **deployment token** (Overview → *Manage deployment token*) into the
   repo secret `AZURE_SWA_API_TOKEN_FREELANCE`.
3. `freelance/runtime-config.js` already points at
   `https://lad-freelance-api.azurewebsites.net`; change `FL_API_BASE` if you
   named the App Service differently. Push to `main` — the `freelance-swa`
   workflow deploys the folder (~30 s).
4. **Subdomain.** In the Azure DNS zone `legalaffairstraining.com` (resource
   group `clpd-prod`) add a CNAME: `freelance` → `<swa-host>.azurestaticapps.net`.
   Then on the Static Web App: *Custom domains* → *Add* → `freelance.legalaffairstraining.com`
   → CNAME validation. Azure issues and renews the certificate itself.
   ```sh
   az network dns record-set cname set-record -g clpd-prod -z legalaffairstraining.com -n freelance -c <swa-host>.azurestaticapps.net
   az staticwebapp hostname set -n clpd-freelance -g clpd-prod --hostname freelance.legalaffairstraining.com
   ```
   This validates only once the domain's nameservers at the registrar are the
   Azure DNS set (the same change that moves www to Azure).
5. Open the portal, sign in with `BOOTSTRAP_ADMIN_EMAIL` and the temporary
   password, set your own password, and you land in the admin console.

The SWA's `staticwebapp.config.json` allows the portal to call any
`*.azurewebsites.net` API and to frame the SCORM player from it, and serves
the Dubai font and the Arabic dictionary from the folder itself (no Google
Fonts, no third-party CDN for the interface).

---

## 4. First day: build a course and put lawyers on it

1. **Lawyer accounts** → *Add account* → kind **Freelance lawyer** → name, email
   and licence / registration number → Create. Copy the temporary password and
   pass it on; they change it on first sign-in. (Add admins as **Training admin**.)
2. **Courses** → *New course*: title, one-line summary, a welcome message, and
   whether steps must be done in order. Add steps with *Add step* and reorder them.
3. Attach content to each step — *Upload module* (the SCORM `.zip` as exported,
   with a pass mark), *Attach document* (a file or a link), or *Teach* (the
   document the AI trainer should teach from; *Draft from the material* proposes
   the key elements).
4. Add anything else to the **Reference library**, pick a photo and colour, and
   press **Publish**. *Preview course page* shows what the lawyer sees.
5. **Assign to lawyers** → search names or licence numbers, or tick **Everyone**,
   optionally a due date and a note. Each lawyer sees it on *My training*.
6. Track it under **Learners & progress** and **Overview**.

---

## 5. How tracking works

Identical to the CLPD platform and Living Horizon: every sitting of a step is
an attempt (opened, heartbeat every 30 s, closed); completion and percentages
are derived from attempts on the server and no page can set them; a SCORM
module completes when the package itself reports `completed`/`passed`; an AI
session completes when the trainer has covered every key element and at least
five minutes were spent; a document completes when marked read; a course is
complete when every required step is. Abandoned sittings settle after two hours
with their time kept.

---

## 6. Local development

```sh
cd backend
cp .env.example .env
#   APP_BRAND=freelance
#   BOOTSTRAP_ADMIN_EMAIL=you@legal.dubai.gov.ae
#   BOOTSTRAP_ADMIN_PASSWORD=ChangeMe-12345
npm install
npm run migrate                 # skips the LAD data migrations on this brand
node scripts/ensure-admin.js    # creates the bootstrap admin (boot.sh does this in the container)
npm start
# portal: http://localhost:4000/freelance/       API: http://localhost:4000/api/v1/health
```

Tests: `npm run test:freelance` — migrates its own database
(`data/freelance-test.sqlite`) and checks the brand end to end: LAD data
skipped, a firm-less lawyer with a licence number as a learner, "everyone" and
search, course publish / enrol / progress, cohort and overview.

---

## 7. Roles and access

| Role (in the database) | Shown as | Can |
|---|---|---|
| `lawyer` | Freelance lawyer | Sign in, see *My training*, open any published course, be assigned courses. No firm — on this brand a lawyer account needs no `firm_id`. |
| `lad_admin` | Training admin | Everything a lawyer can, plus build and publish courses, assign, track, manage lawyer accounts |
| `lad_super_admin` | Super admin | Everything, including managing other admins and changing roles |

The role identifiers are the shared platform's; the portal labels them for
the freelance programme. Firm compliance officers, providers and the CLPD
platform's lawyers cannot sign in here — each instance has its own database.

---

## 8. What differs from the CLPD platform (and why nothing was forked)

| | CLPD platform | Freelance portal |
|---|---|---|
| Learners | lawyers under firms, firm officers | individually licensed lawyers, no firm |
| Access to courses | credits, bookings, CLPD hours | free, assigned or self-enrolled |
| Catalogue | accredited providers and their events | the Department's own courses only |
| Admin | full CLPD console | courses · learners & progress · overview · lawyer accounts |
| Identity | LAD brand, English + Arabic | the same files from `frontend/`, copied in at deploy time |

All of this is `backend/src/brand.js` (`freelance`: `ladData:false`,
`learnerKind:'lawyer'`, `firms:false`) and `backend/src/services/learners.js`
deciding who counts as a learner; the routes, the spine and the player are
shared and unchanged.
