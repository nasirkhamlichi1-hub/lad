# Working in this repo

## Anam avatar rules

These apply to every change touching the avatar learning bots
(`backend/bots/`, `backend/src/services/anam.js`, `frontend/learning-bot.html`).
They come from Anam's own custom-LLM guidance — treat the live docs
(<https://anam.ai/docs/personas/llms/custom-llms>, <https://anam.ai/docs/llms.txt>)
as the source of truth over anything remembered.

**ALWAYS:**

- Mint session tokens on the **server**; only the short-lived token reaches the
  browser. `POST /api/v1/trainer/anam/session-token` is the only correct path.
- Prepare on page load — bundle/preload the SDK and prefetch the session token
  (it lives about an hour). The user gesture should only have to start the
  stream.
- Keep replies concise and conversational. They get spoken aloud.

**NEVER:**

- Expose `ANAM_API_KEY` to the client.

### Why this project is on the frontend-driven option

Anam's server-endpoint option is lower latency but needs an endpoint matching a
supported spec (OpenAI, Azure OpenAI, Gemini, Groq). It does not fit here, for
two independent reasons:

1. The brain is the Anthropic Messages API, which is not a supported spec.
2. `trainerBrain.nextTurn()` returns `{say, covered[], complete}` — the metadata
   drives CPD key-element tracking. Under the server-endpoint option Anam would
   speak the raw JSON and the tracking would be lost.

So the bots run with `llmId: 'CUSTOMER_CLIENT_V1'`, which switches Anam's hosted
brain off. Without it Anam answers as well as our brain and the learner hears
two replies; it also keeps an inline `personaConfig` from being rejected as a
legacy token. `ANAM_LLM_ID` can override or (set empty) omit the field if Anam
changes the contract.

### Known gap

Speech is sent as one chunk via `createTalkMessageStream()`, so the first
syllable waits for the whole brain reply. True streaming needs the brain to emit
`say` incrementally, separate from its coverage metadata — streaming its current
raw output would feed JSON syntax to the avatar. The stream API is already in
place, so only the brain's output format has to change.

### Adding a bot

Config, not code: see `backend/bots/README.md`.
