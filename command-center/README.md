# Orbit — Mission Control

A 3D portfolio "mission control" for the Government of Dubai Legal Affairs
Department. Each **division is a planet**; each **project is a moon** orbiting it.
Colour encodes health (green on‑track · amber at‑risk · red failing), the central
**sun is overall portfolio health**, and an AI analyst answers spoken questions
like *"which project is failing?"* or *"what should I be concerned about?"*.

Single self‑contained file (`index.html`). three.js loads from a CDN. All data
lives in the browser (`localStorage`) — each division edits its own KPIs and
project progress/status/concerns in the inspector panel.

## The AI analyst
The voice console calls **`/api/analyst`** — an Azure Static Web Apps managed
function (`command-center/api/analyst`) that proxies to the Claude API
(`claude-opus-4-8`). It receives `{ question, context }` (a live JSON snapshot of
divisions/projects/KPIs) and returns `{ answer }`. The API key lives in Azure,
never in the browser.

- **Until `ANTHROPIC_API_KEY` is set**, the function returns 503 and the
  frontend automatically falls back to the **built‑in offline analyst** — so the
  app is fully usable without it (great for the local/CDN-only demo).
- With the key set, answers come from Claude with full reasoning, and the
  dashboard still highlights any projects the answer names.

## Deploy to Azure Static Web Apps
A workflow is included: `.github/workflows/azure-static-web-apps-command-center.yml`
(app `command-center`, api `command-center/api`, no build step).

**Go‑live checklist**
1. In the Azure Portal, **create a Static Web App** and connect this repo +
   branch (or reuse the included workflow). Set **App location** `command-center`,
   **Api location** `command-center/api`, **Output location** empty.
2. Add the repo secret **`AZURE_STATIC_WEB_APPS_API_TOKEN_COMMAND_CENTER`**
   (the deployment token from the new Static Web App). Azure adds this
   automatically if you let it generate the workflow.
3. In the Static Web App → **Settings → Environment variables**, add
   **`ANTHROPIC_API_KEY`** = your `sk-ant-…` key (from console.anthropic.com).
4. Push to the branch — the app deploys and the analyst goes live.

three.js is fetched from `cdn.jsdelivr.net` at runtime (standard on Azure). To run
fully offline later, vendor three.js into the folder and point the import map at
local paths.

## Run locally
Because the page uses ES‑module imports, serve it (don't open via `file://`):

```bash
cd command-center
npx serve .          # or: python3 -m http.server 8080
```

There's no API locally, so the voice console uses the offline analyst — which is
the intended fallback.
