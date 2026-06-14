# Orbit — Mission Control

A 3D portfolio "mission control" for the Government of Dubai Legal Affairs
Department. Each **division is a planet**; each **project is a moon** orbiting it.
Colour encodes health (green on‑track · amber at‑risk · red failing), the central
**sun is overall portfolio health**, and an AI analyst answers spoken questions
like *"which project is failing?"* or *"what should I be concerned about?"*.

Single self‑contained file (`index.html`). three.js loads from a CDN. All data
lives in the browser (`localStorage`) — each division edits its own KPIs and
project progress/status/concerns in the inspector panel.

## Run locally
Because the page uses ES‑module imports, open it through a local web server
(double‑clicking `file://` can block module/CDN loading in some browsers):

```bash
cd command-center
npx serve .          # or: python3 -m http.server 8080
```

Then visit the printed URL in Chrome or Edge (voice input needs one of those).

## Deploy to Azure Static Web Apps
Same model as `reception-portal`:

- **App location:** `command-center`
- **Output / artifact location:** `command-center` (no build step)
- `staticwebapp.config.json` (included) sets security headers and SPA fallback.

Point a Static Web App (or a build of your existing workflow) at the
`command-center` folder and deploy — no backend required. three.js is fetched
from `cdn.jsdelivr.net` at runtime, so the app needs outbound internet (standard
on Azure). To run fully offline later, vendor three.js into the folder and switch
the import map to local paths.

## Connect a real AI (optional)
The voice console uses a built‑in offline analyst by default. To use a real
model, set `window.ORBIT_CONFIG.aiEndpoint` (top of `index.html`) to a route that
accepts `{ question, context }` and returns `{ answer }` — the same shape as the
Maryam `/api/lex` function in `reception-portal`.
