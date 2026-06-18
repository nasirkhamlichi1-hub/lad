# AiModel (Maryam) — stable endpoint setup

Maryam, the Skills mapping, the copilot briefing and the accreditation AI
review all call **AiModel** via `src/services/aimodel.js`. If these features say
*"Maryam isn't working"*, AiModel is unconfigured or pointing at a dead URL.

## Use the stable Azure OpenAI endpoint (recommended)

Do **not** point `AIMODEL_ENDPOINT` at a `*.trycloudflare.com` quick-tunnel.
Those hostnames rotate every time the tunnel restarts, so Maryam works one day
and 503s the next. Point it at the Azure OpenAI resource directly — that
hostname never changes.

In the **Azure Portal → your Azure OpenAI resource**:

- **Endpoint** — *Keys and Endpoint* blade, e.g. `https://my-aoai.openai.azure.com`
- **Key** — *Keys and Endpoint* blade (KEY 1)
- **Deployment** — *Deployments* blade, the deployment **name** (e.g. `gpt-4o`)

Then in the **Render dashboard → `lad-clpd-backend` → Environment**, set:

| Key | Value |
| --- | --- |
| `AIMODEL_ENDPOINT` | `https://<resource>.openai.azure.com` (no trailing slash, no `/openai/...` path) |
| `AIMODEL_KEY` | the resource KEY 1 |
| `AIMODEL_DEPLOYMENT` | the deployment name, e.g. `gpt-4o` |
| `AIMODEL_API_VERSION` | `2024-08-01-preview` (optional — this is the default) |

Save → Render redeploys (~1–2 min).

`aimodel.js` auto-detects Azure from the `openai.azure.com` host and calls
`/openai/deployments/<deployment>/chat/completions?api-version=...` with the
`api-key` header. No code change is needed — only these env vars.

## Verify

1. `https://lad-clpd-backend.onrender.com/api/v1/health` → `{"status":"ok"}`
2. Open the lawyer portal → ask Maryam something, or run **Skills** mapping.
   A real answer = configured. A 503 / "not configured" = re-check the three
   vars above (most often the endpoint still has a trailing path or points at a
   stale tunnel).

## How fallbacks behave when AiModel is down

The copilot briefing, study plan and Skills mapping degrade to deterministic
heuristics so the portal never hard-breaks — but the chat assistant needs a
live endpoint. Keeping the Azure endpoint stable is the durable fix.
