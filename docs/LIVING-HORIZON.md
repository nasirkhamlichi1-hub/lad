# Living Horizon — staff training portal: runbook

The internal training portal for Living Horizon staff, built on the training
engine already in this repository (the learning spine, the SCORM player, the
policy library, the AI trainer) and deployed as its own site with its own
database. No credits, no bookings, no lawyer roll — every course is free, every
staff member can be tracked, and progress is saved so people come back to
exactly where they stopped.

> One codebase, one container image, two deployments. `APP_BRAND=living-horizon`
> turns the backend into the Living Horizon instance; the `living-horizon/`
> folder is its front end. The Legal Affairs Department deployment is untouched.

---

## 1. What it is made of

| Part | Where | Hosted on |
|---|---|---|
| Front end (the portal) | `living-horizon/` | Azure **Static Web App** — its own, separate from the CLPD one |
| Backend API + database | `backend/` (the existing image, `APP_BRAND=living-horizon`) | Azure **App Service, Web App for Containers**, single instance, persistent `/home` storage |
| Image build | `.github/workflows/backend.yml` | GitHub Actions → `ghcr.io/<owner>/lad-clpd-backend:latest` |
| Portal deploy | `.github/workflows/living-horizon-swa.yml` | GitHub Actions → the Static Web App |

What a staff member gets:

- **Sign in** with a work email and password (`index.html`).
- **My training** (`home.html`): courses assigned to them, courses they started, everything else available, with progress on each and a "pick up where you left off" card.
- **A course** (`course.html`): the author's welcome, the pathway of steps in order, and the policy & reference library. A step is one of:
  - an **e-learning module** — a SCORM package (Articulate Rise/Storyline, iSpring…) played inside the page; the package's own status and score complete the step, and its bookmark (`suspend_data`) is saved so it resumes;
  - a **policy document** — a PDF/Word file or link, opened in the page and marked as read;
  - an **AI trainer session** — a one-to-one conversation (voice or typing) that teaches from the document the admin uploaded and does not finish until every key element is understood. Pause keeps the place.
- Time on task is banked every 30 seconds while a step is open, so a closed laptop loses nothing.

What a training administrator gets (`admin.html`):

- **Courses** — create a course, add steps in any order, upload the SCORM zip, attach the policy documents, teach the AI trainer from a document (its text is extracted in the browser; key elements can be AI-drafted from it), set a photo and colour, and publish. Nothing reaches staff until every step has content.
- **Learners & progress** — every course and who is on it; each person's full record (print / CSV); assign a course to named staff or to **everyone**, with an optional due date and note.
- **Overview** — completion rate, hours, who has gone quiet, where people get stuck.
- **Staff accounts** — add staff members and admins, reset passwords, suspend.

---

## 2. Stand up the backend (Azure App Service)

1. **Create the Web App** — Linux, *Web App for Containers*, one instance (SQLite is
   single-writer; do not scale out). Region of your choice (UAE North if data must
   stay in the UAE). Suggested name: `living-horizon-training-api`.
2. **Point it at the image.** Deployment Center → Container registry → **GHCR**,
   image `ghcr.io/<owner>/lad-clpd-backend`, tag `latest`, continuous deployment
   on. (Or mirror the image into an Azure Container Registry and pull from there.)
   Alternatively let GitHub push it: download the app's *publish profile* and add it
   as the repo secret `AZURE_WEBAPP_PUBLISH_PROFILE_LIVING_HORIZON` and the repo
   variable `LIVING_HORIZON_WEBAPP_NAME`; the `deploy-living-horizon` job in
   `backend.yml` then deploys on every push to `main`.
3. **Persistent storage.** Configuration → General settings → *App Service storage*:
   **On** (so `/home` survives restarts). The database lives at `/home/data/…`.
4. **Application settings** (Configuration → Application settings):

   | Setting | Value |
   |---|---|
   | `APP_BRAND` | `living-horizon` |
   | `APP_BRAND_NAME` | `Living Horizon` (optional — the name shown on the portal) |
   | `NODE_ENV` | `production` |
   | `PORT` / `WEBSITES_PORT` | `4000` / `4000` |
   | `DATABASE_URL` | `/home/data/living-horizon.sqlite` |
   | `JWT_SECRET` | a fresh random value: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `JWT_EXPIRES_IN` | `8h` |
   | `CORS_ORIGIN` | the portal's URL(s), comma-separated — e.g. `https://<swa-name>.azurestaticapps.net` (add the custom domain later). This also allows the portal to frame the SCORM player. |
   | `PUBLIC_API_BASE` | `https://living-horizon-training-api.azurewebsites.net` |
   | `FRONTEND_POST_LOGIN_URL` | `https://<portal-url>/index.html` (required by the boot check; UAE Pass is not used) |
   | `FRONTEND_BASE_URL` | `https://<portal-url>` (password-reset links are built from it) |
   | `BOOTSTRAP_ADMIN_EMAIL` | your email — creates the first super admin on boot if it does not exist |
   | `BOOTSTRAP_ADMIN_PASSWORD` | a temporary password (8+ chars); you are made to change it on first sign-in. Remove this setting once you are in. |
   | `BOOTSTRAP_ADMIN_NAME` | `First Last` (optional) |
   | `ANTHROPIC_API_KEY` | for the AI trainer's brain and AI drafting (optional — without it the trainer runs a scripted fallback and drafting says so) |
   | `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |
   | `TRAINER_BRAIN_MODEL` | `claude-haiku-4-5` (the quick spoken-turn model; default) |
   | `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | optional — the trainer's voice; browser voice otherwise |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | optional — password-reset emails; queued but unsent without them |
   | `AZURE_STORAGE_CONNECTION_STRING` | optional — SCORM packages and documents over 10 MB go to Blob storage; below that they are stored inline |
   | `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `120` |

   UAE Pass settings are not needed — the portal signs staff in with email and password.
5. **Start it** and check:
   ```sh
   curl -fsS https://living-horizon-training-api.azurewebsites.net/api/v1/health
   # → {"status":"ok","service":"living-horizon-training-backend","brand":"living-horizon",...}
   ```
   On boot the container runs the schema migrations (skipping every LAD data
   migration — no Dubai lawyer roll, no demo sign-ins), creates the bootstrap
   admin, and suspends any LAD test account that might have come in with a copied
   database. Nothing else is seeded: the instance starts empty.

---

## 3. Stand up the portal (Azure Static Web App)

1. **Create a Static Web App** on the same subscription. Plan: Free is fine to
   begin. Deployment source: *Other* (GitHub Actions in this repo will upload).
2. Copy its **deployment token** (Overview → *Manage deployment token*) into the
   repo secret `AZURE_SWA_API_TOKEN_LIVING_HORIZON`.
3. Edit `living-horizon/runtime-config.js` and set `LH_API_BASE` to the App
   Service URL from §2. Commit and push to `main` — the
   `living-horizon-swa` workflow deploys the folder (~30 s).
4. Put the Static Web App's URL into the backend's `CORS_ORIGIN` (§2.4) and restart
   the App Service.
5. Open the portal, sign in with `BOOTSTRAP_ADMIN_EMAIL` and the temporary
   password, set your own password, and you land in the admin console.

The SWA's `staticwebapp.config.json` already allows the portal to call any
`*.azurewebsites.net` API and to frame the SCORM player from it. If you rename
the App Service to a custom domain, add that host to `connect-src` and
`frame-src` there.

---

## 4. First day: build a course and put staff on it

1. **Staff accounts** → *Add account* → kind **Staff member** → name and email →
   Create. Copy the temporary password and pass it on; they change it on first
   sign-in. (Repeat, or add admins as **Training admin**.)
2. **Courses** → *New course*: title, one-line summary, a welcome message, and
   whether steps must be done in order. Start with an e-learning module, a policy
   document or an AI session; add more steps with *Add step*, and reorder them.
3. Attach content to each step:
   - **E-learning module** → *Upload module* → drop the SCORM `.zip` exactly as the
     authoring tool exported it. Set the pass mark.
   - **Policy document** → *Attach document* → drop the PDF/Word file, or paste a link.
     *Draft title & description with AI* fills in the card text from the file.
   - **AI trainer session** → *Teach* → drop the document the trainer should teach
     from; check the extracted text; *Draft from the material* proposes the key
     elements (each one quoted from the document); adjust the teaching style on
     the *Teaching* tab.
4. Add anything else staff should have to hand in the **Policy documents &
   reference library** (not graded — just there to read), pick a photo and colour,
   and press **Publish**. Preview it with *Preview course page*.
5. **Assign to staff** → search names, or tick **Everyone**, optionally a due date
   and a note. Each person sees it on *My training* immediately with a
   notification.
6. Track it under **Learners & progress** (per course, per person, print / CSV)
   and **Overview** (the whole programme).

---

## 5. How tracking works (what the numbers mean)

- Every sitting of a step is an **attempt** (opened, heartbeat every 30 s, closed).
  Completion and percentages are **derived** from attempts on the server; no page
  can set them. A SCORM module completes when the package itself reports
  `completed`/`passed`; an AI session completes when the trainer has covered
  every key element and at least five minutes were spent; a document completes
  when marked done.
- A course is complete when every **required** step is complete. Optional steps
  still record progress but cannot hold the course open.
- **Resume**: the module's bookmark, the trainer's recap and the reading's
  position are saved on every heartbeat, so `Resume` on *My training* opens the
  exact step.
- Abandoned sittings (tab closed, laptop asleep) are settled automatically after
  two hours with their time kept; the Overview shows any still open and can
  settle them now.

---

## 6. Local development

```sh
cd backend
cp .env.example .env
#   APP_BRAND=living-horizon
#   BOOTSTRAP_ADMIN_EMAIL=you@livinghorizon.com
#   BOOTSTRAP_ADMIN_PASSWORD=ChangeMe-12345
npm install
npm run migrate                 # skips the LAD data migrations on this brand
node scripts/ensure-admin.js    # creates the bootstrap admin (boot.sh does this in the container)
npm start
# portal: http://localhost:4000/lh/       API: http://localhost:4000/api/v1/health
```

Tests: `npm run test:learning` (the spine and topic authoring) and
`node scripts/test-living-horizon.js` (a Living Horizon instance end to end:
migrations skipped, staff learner, catalogue, assignment, materials access).

---

## 7. Moving it to its own website later

The portal is a folder of static files and the backend is an image; both move
without code changes:

1. Point the new host's DNS at the Static Web App (custom domain in the SWA
   portal) — or upload `living-horizon/` to any static host.
2. Add the new origin to the backend's `CORS_ORIGIN`; if the API also gets a
   custom domain, put it in `runtime-config.js` and in the SWA's CSP
   (`connect-src` / `frame-src`).
3. Move the database file if the backend moves: `sqlite3 …/living-horizon.sqlite
   ".backup out.sqlite"` on the old host, upload it to the new `/home/data/`,
   restart. Same procedure as `docs/MIGRATION-TO-CORP-AZURE.md` §3.

---

## 8. Roles and access

| Role (in the database) | Shown as | Can |
|---|---|---|
| `lad_staff` | Staff member | Sign in, see *My training*, open any published course, be assigned courses |
| `lad_admin` | Training admin | Everything a staff member can, plus build and publish courses, assign, track, manage staff-member accounts |
| `lad_super_admin` | Super admin | Everything, including managing other admins and changing roles |

The role identifiers are the shared platform's; the portal labels them for
Living Horizon. Accounts from the CLPD platform (lawyers, firm officers,
providers) cannot sign in to this portal.
