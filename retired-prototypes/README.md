# Retired pages — not deployed

These two were browser-only prototypes from before the trainer moved onto the
backend. Both ask the person using them to paste third-party API keys into a
Government of Dubai page and then keep those keys in `localStorage`, which is
not something the Department should ship.

- **ai-trainer-live.html** — the original Anam + Claude trainer, driven entirely
  from the browser with the user's own keys. Superseded by `ai-trainer.html`,
  which talks to `/api/v1/trainer/*` with the keys held server-side. Course hubs
  already link to `ai-trainer.html`; the `/ai-trainer` route and the Trainer
  Admin default URL now point there too.
- **anam-check.html** — an Anam SDK diagnostic harness. A development tool that
  was being served publicly.

They are kept here rather than deleted so the working prototypes are still on
record. Nothing in the deployed site references either file. Delete this folder
once you are confident neither is needed.
