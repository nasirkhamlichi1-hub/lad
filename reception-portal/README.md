# Reception Training Academy — landing site

A single-page, branded landing site for **Legal Affairs Department reception
staff** to sign in and start their SCORM training (hosted in Docebo).

It reuses the official `legal.dubai.gov.ae` look & feel — the Dubai Government
+ LAD logos, the dark-navy header, the green/gold palette, and the Instrument
Serif / IBM Plex Sans Arabic typography used across the Department's portals.

```
reception-portal/
├── index.html               The whole site (self-contained — HTML+CSS+JS)
├── img/                      Brand photography (reception, library, flag)
├── staticwebapp.config.json  Azure Static Web Apps routing + security headers
└── README.md                This file
```

---

## 1. Run it locally

No build step. Any static file server works:

```sh
cd reception-portal

# Option A — Python (built in on most machines)
python3 -m http.server 8080

# Option B — Node
npx serve .
```

Then open **http://localhost:8080**.

> Open it through a server (not `file://`) so the fonts and the Docebo
> hand-off behave the same as in production.

---

## 2. Point it at your Docebo training

Open `index.html` and edit the `RECEPTION_CONFIG` block near the top
(it's the only thing you need to change):

```js
window.RECEPTION_CONFIG = {
  doceboUrl:      'https://YOUR-TENANT.docebosaas.com',   // ← your Docebo URL
  courseDeepLink: '',                                     // ← optional: direct course link
  usernameParam:  'login_required_username',
  supportEmail:   'training@legal.dubai.gov.ae'
};
```

**How sign-in works.** The page collects the user's email (and optionally
remembers it), then hands them to Docebo to complete authentication —
credentials are never stored on this site. This is the secure, standard
pattern. When you're ready for true single sign-on, replace the hand-off with
your Docebo **SSO** endpoint (SAML/OIDC) so staff sign in once for the
Department and land straight in the course.

- `doceboUrl` — staff land on your Docebo login/home.
- `courseDeepLink` — if set, staff go straight to the specific reception
  course or learning plan (find the link in Docebo → course → *Share*).

---

## 3. Deploy to Azure

This repo already deploys other front-ends to **Azure Static Web Apps**
(`frontend/staticwebapp.config.json`). The same approach works here, and the
included `staticwebapp.config.json` is ready to go.

### Quickest path — Azure CLI

```sh
# from the repo root
az staticwebapp create \
  --name lad-reception-training \
  --resource-group <your-rg> \
  --location "westeurope" \
  --source . \
  --app-location "reception-portal" \
  --output-location "" \
  --login-with-github
```

- **app-location** = `reception-portal` (where `index.html` lives)
- **output-location** = empty (no build step)

### Or via the Azure Portal

1. **Create resource → Static Web App.**
2. Connect this GitHub repo and branch.
3. Build details: *App location* = `reception-portal`, *Output location* =
   blank, *Api location* = blank. Build preset: **Custom** (no framework).
4. Azure adds a GitHub Action that redeploys on every push.

You'll get a URL like `https://lad-reception-training.azurestaticapps.net`.
Add the Department's custom domain (e.g. `training.legal.dubai.gov.ae`) under
**Custom domains** and Azure provisions the TLS certificate automatically.

> Tip: keep `RECEPTION_CONFIG` as the single source of truth for the Docebo
> URL. To change platforms or course links later, edit that block and push —
> the GitHub Action redeploys in ~1 minute.

## 4. Turn on "Lex" — the AI assistant (optional)

Lex is an in-page assistant for desk staff: a "Ask Lex" button opens a chat
where staff describe a visitor's situation and get the right service, channel,
fee and a "say this" line. It runs as an **Azure Static Web Apps managed
function** (`reception-portal/api/lex`) that proxies to the Claude API — the API
key lives in Azure, never in the browser. Until a key is set, Lex answers with a
friendly "not set up yet" message, so the site is safe to ship without it.

To switch it on:

1. Get an Anthropic API key from **console.anthropic.com** → API Keys.
2. Azure Portal → your Static Web App → **Settings → Environment variables**
   (a.k.a. *Configuration / Application settings*) → **+ Add**:
   - Name `ANTHROPIC_API_KEY`, Value your `sk-ant-…` key → Save.
3. Done — Lex starts answering. The function deploys automatically because the
   workflow's `api_location` is set to `reception-portal/api`.

**Model & cost.** Lex uses `claude-opus-4-8`. For a busy desk you can trade some
quality for lower cost/faster replies by changing `MODEL` to `claude-haiku-4-5`
at the top of `api/lex/index.js`. Lex answers only from the verified Department
knowledge baked into the function's system prompt — it won't invent fees or
services.
