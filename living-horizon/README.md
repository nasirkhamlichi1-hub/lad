# Living Horizon — staff training portal (front end)

The internal training portal for Living Horizon staff. Static HTML/JS, deployed
to its own Azure Static Web App, talking to the shared training backend in
`../backend` running with `APP_BRAND=living-horizon`.

Everything a staff member sees:

| Page | What it is |
|---|---|
| `index.html` | Sign in (email + password). Routes staff to **My training**, admins to the **Admin console**. |
| `home.html` | My training — assigned and started courses with progress, "pick up where you left off", everything else available. |
| `course.html?topic=ID` | A course: the welcome, the pathway of steps (e-learning modules, policy documents, AI trainer sessions) with the learner's state on each, and the policy & reference library. Progress is saved as they go. |
| `trainer.html?lesson=ID` | The one-to-one AI trainer for a step (voice or typing). Pause keeps the place; Finish completes the step once every key element is covered. |
| `change-password.html`, `reset-password.html` | First sign-in and forgotten-password flows. |

And the training administrator:

| Page | What it is |
|---|---|
| `admin.html` | The console. Four workspaces in tabs: |
| `admin-courses.html` | **Courses** — build a course step by step: upload SCORM modules, attach policy documents, teach the AI trainer from a document; set the look; publish. |
| `admin-progress.html` | **Learners & progress** — who is on each course, how far, their full record (print / CSV); assign a course to named staff or to everyone. |
| `admin-overview.html` | **Overview** — the whole programme: completion, hours, who has gone quiet, where people get stuck. |
| `admin-staff.html` | **Staff accounts** — add staff members and admins, reset passwords, suspend. |

Shared files: `lh.css` (the look), `lh-shell.js` (top bar, role gate, session expiry),
`lh-api.js` (the API client), `runtime-config.js` (**the one file to edit** to point
at a backend).

## Run it locally

```sh
cd backend
cp .env.example .env            # set APP_BRAND=living-horizon and the BOOTSTRAP_ADMIN_* values
npm install && npm run migrate && npm start
# → http://localhost:4000/lh/   (this folder, served by the API in development)
```

## Deploy

See `../docs/LIVING-HORIZON.md` — the runbook for the Azure Static Web App, the
App Service, the settings, and the first sign-in.
