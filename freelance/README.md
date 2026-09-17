# Legal Affairs Department — freelance lawyers training portal (front end)

The Department's training portal for its freelance lawyers: the same engine
as the CLPD platform, cut down to what a small cohort needs. Static HTML/JS,
deployed to its own Azure Static Web App, talking to the shared training
backend in `../backend` running with `APP_BRAND=freelance`.

No credits (every course is free), no firms or compliance officers, no
accredited-provider catalogue. Lawyers are individually licensed accounts an
administrator creates; they sign in with email and password.

Everything a lawyer sees:

| Page | What it is |
|---|---|
| `index.html` | Sign in (email + password). Routes lawyers to **My training**, admins to the **Admin console**. |
| `home.html` | My training — assigned and started courses with progress, "pick up where you left off", everything else available. |
| `course.html?topic=ID` | A course: the welcome, the pathway of steps (e-learning modules, reference documents, AI trainer sessions) with the learner's state on each, and the reference library. Progress is saved as they go. |
| `trainer.html?lesson=ID` | The one-to-one AI trainer for a step (voice or typing). Pause keeps the place; Finish completes the step once every key element is covered. |
| `change-password.html`, `reset-password.html` | First sign-in and forgotten-password flows. |

And the training administrator:

| Page | What it is |
|---|---|
| `admin.html` | The console. Four workspaces in tabs: |
| `admin-courses.html` | **Courses** — build a course step by step: upload SCORM modules, attach reference documents, teach the AI trainer from a document; set the look; publish. |
| `admin-progress.html` | **Learners & progress** — who is on each course, how far, their full record (print / CSV); assign a course to named lawyers or to everyone. |
| `admin-overview.html` | **Overview** — the whole programme: completion, hours, who has gone quiet, where people get stuck. |
| `admin-lawyers.html` | **Lawyer accounts** — add freelance lawyers (with their licence number) and admins, reset passwords, suspend. |

Shared files: `fl.css` (the portal's layout, on the Department's tokens),
`fl-shell.js` (top bar, role gate, session expiry), `fl-api.js` (the API
client), `runtime-config.js` (**the one file to edit** to point at a backend).

The Department's identity and the Arabic interface are the same files the
CLPD platform uses — `lad-brand.css` + `lad-brand.js` (tokens, Dubai Font, the
Government bar and footer), `lad-rtl.css` + `lad-i18n.js` + `lad-ar.js`
(right-to-left layout, the dictionary, the language switch), `fonts/` and
`favicon.svg`. They live once, in `../frontend/`: the deploy workflow copies
them into this folder so the Static Web App is self-contained, and the local
dev server falls through to `../frontend/` for them. Nothing to keep in step.

## Run it locally

```sh
cd backend
cp .env.example .env            # set APP_BRAND=freelance and the BOOTSTRAP_ADMIN_* values
npm install && npm run migrate && npm start
# → http://localhost:4000/freelance/   (this folder, served by the API in development)
```

## Deploy

See `../docs/FREELANCE.md` — the runbook for the Azure Static Web App, the
App Service, the settings, the subdomain, and the first sign-in.
