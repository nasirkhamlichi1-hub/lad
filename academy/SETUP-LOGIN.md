# Academy — logins, progress tracking & certificates (Azure setup)

The academy works two ways automatically:

- **Local mode** (e.g. the GitHub Pages preview): no backend, progress saved in the
  browser only. Nothing to configure.
- **Hosted mode** (your Azure site, `legalaffairstraining.com`): when the `/api`
  backend is present, the app shows the **Training Solar System** sign-in,
  saves every trainee's progress centrally, and unlocks the **Trainer Console**
  at `/admin.html`.

Your Azure administrator does a one-time setup.

## 1. Host on Azure Static Web Apps
Deploy the `academy` folder as an Azure Static Web App with the API:

- **App location:** `academy`
- **API location:** `academy/api`
- **Output location:** *(empty)*

(There's a ready GitHub Action at
`.github/workflows/azure-static-web-apps-academy.yml` — add the deployment
token as the `AZURE_STATIC_WEB_APPS_API_TOKEN_ACADEMY` secret and run it.)

## 2. Add a storage account
Create (or reuse) an **Azure Storage account** and copy its **connection string**.
Progress is stored in one auto-created table, `academyprogress`.

## 3. Set application settings
On the Static Web App → **Configuration** (or the Function app settings), add:

| Setting | Required | Example | Purpose |
|---|---|---|---|
| `TABLES_CONNECTION` | ✅ | `DefaultEndpointsProtocol=...` | Storage connection string |
| `TRAINEE_PASSWORD` | ✅ | `Legal@2026` | Initial shared password for trainees (changeable later in the console) |
| `ADMIN_PASSWORD` | ✅ | *(a strong secret)* | Password for the Trainer Console at `/admin.html` |
| `AUTH_SECRET` | ✅ | *(a long random string)* | Signs login/certificate tokens |
| `ALLOWED_EMAILS` | optional | `a@x.gov.ae, b@x.gov.ae` | Bootstrap whitelist (you can instead add people in the console) |

> Certificates are **downloaded** by the trainer from the console (PNG or
> print-to-PDF) and sent out manually — no email service is required.

## 4. Run it
- **Trainees:** open the site → **Training Solar System** → sign in with their
  work email + the shared password → train; progress resumes on any device.
- **Trainer:** open `…/admin.html` → sign in with `ADMIN_PASSWORD` to:
  - see everyone's progress (X/11, per-service, last active) and export CSV,
  - **＋ Add trainees** (paste emails),
  - **Change shared password**, or set a personal password / remove a trainee,
  - **download a certificate** (PNG or print-to-PDF) for anyone who's completed
    all 11, and send it to them yourself.

## Notes
- A trainee can have their **own** password (set in the console); otherwise they
  use the shared password.
- Removing a trainee can optionally delete their saved progress.
- Security here is intentionally lightweight (shared password) — suitable for an
  internal training tool. For stricter access, this can later be swapped to
  Microsoft 365 single sign-on (Azure Entra ID).
