# AI Trainer — realistic-avatar 1-2-1 CLPD sessions

A fully AI-generated trainer that runs as a real-time, face-to-face conversation:
the attendee **talks** to a photoreal expert, the expert **talks back** in a real
voice, and — crucially — the expert **watches the attendee through their camera**
and reacts to attention, mood, and distraction. No reading, no typing.

This document is the vendor research, the architecture, and the build plan. A
working prototype already ships in this repo (see [What's already built](#whats-already-built)).

---

## ⏯️ RESUME HERE — start of the fresh session

**Branch:** `claude/vibrant-goodall-6odfk4` work is on `claude/vigilant-curie-lrtqi0`.

**The model (ONE, replaces Tavus — Tavus & ElevenLabs fully removed):**
- **Face + Voice** → **Anam** photoreal avatar (`ANAM_API_KEY` + `ANAM_AVATAR_ID`; optional
  `ANAM_VOICE_ID`). Anam speaks too — no separate TTS. Falls back to an animated face +
  browser voice if unset.
- **Brain** → **Claude** (`ANTHROPIC_API_KEY`, model `claude-sonnet-4-6`) via
  `POST /api/v1/trainer/turn`, returning `{say, covered[], complete}` for hard
  key-element tracking. Falls back to a scripted brain if unset.
- **Eyes** → **MorphCast** (`MORPHCAST_LICENSE_KEY`, in-browser) augmenting the free
  TensorFlow.js model (phone + presence). All perception is in-browser.
- Trainer page: `frontend/ai-trainer.html`. Admin uploader: `lad-trainer-admin.html`.

**✅ VERIFIED LIVE (2026-06-16):** the **Claude brain works end-to-end** — teaches in short
turns, reacts to camera perception (e.g. asks to put a phone away), tracks coverage
`[1]→[1,2]→[1,2,3]` and completes with a recap. Egress to `api.anthropic.com` is open.
The model id `claude-sonnet-4-6` is the fix (the old default 404'd).

**⛔ BLOCKED: Anam.** `api.anam.ai` is NOT in this environment's egress allowlist
(`Host not in allowlist: api.anam.ai`), so Anam cannot be reached or verified yet.

### DO THIS FIRST in the fresh session (Anam verification)
Prereqs the user must have done: added `api.anam.ai` to the network allowlist, set
`ANAM_API_KEY` + `ANTHROPIC_API_KEY` as env vars, started THIS new session.
1. Confirm reachability: `curl -s -o /dev/null -w "%{http_code}" https://api.anam.ai` (≠403).
2. List avatars to choose `ANAM_AVATAR_ID` (try `GET /v1/avatars` or `/v1/personas` with
   `Authorization: Bearer $ANAM_API_KEY`).
3. Mint a session token (`POST /v1/auth/session-token`) and **fix
   `backend/src/services/anam.js`** to match Anam's real request/response shape.
4. Verify the front-end Anam SDK calls in `frontend/ai-trainer.html` (`initAnam`) against
   current Anam docs (createClient / streamToVideoElement / talk).
5. End-to-end: open `ai-trainer.html`, start a session, confirm photoreal face speaks the
   Claude lines and perception still flows.

**🔐 SECURITY:** the Claude and Anam API keys were pasted in chat — **rotate both** once
verified, and keep them only as env vars (`.env` is gitignored).

**Run/seed locally:** `cd backend && npm i && npm run migrate && npm start`; seed courses
with `node scripts/seed-trainer-aviation.js` (also `-civil-code`, `-mock`). Status:
`GET /api/v1/trainer/status` → `premium:true` once Anam+Claude are set.

**Deploy (Render):** `render.yaml` is ready — set `ANAM_API_KEY`, `ANAM_AVATAR_ID`,
`ANTHROPIC_API_KEY`, `CORS_ORIGIN`, `PUBLIC_API_BASE`; migrations auto-run on boot.

**Key files:** `backend/src/services/{anam,trainerBrain,trainerPrompt,trainerStore}.js`,
`backend/src/routes/trainer.js`, `frontend/{ai-trainer.html,lad-trainer-admin.html,api-client.js}`.

---

## ⏳ Learning & progress backend (multi-user, resumable)

Migration `005-trainer-progress.sql` adds a `trainer_progress` table — **one row
per (lawyer, lesson)** — that aggregates every session into one durable learning
record. Many lawyers studying the same lesson simply get one row each, which is
how we track multiple users against the same material.

**What it tracks:** `status` (in_progress / completed), `percent_complete`, cumulative
`total_seconds`, `session_count`, `resume_context` (the recap fed into the next
conversation), `cpd_points_awarded`, and timestamps.

**Resume:** `POST /sessions/:id/pause` ends the live Tavus room (freeing the
concurrency slot) but keeps progress open and stores a resume recap built from
the transcript + objectives. Starting the lesson again (`POST /sessions`) detects
the in-progress record and creates a **fresh** conversation seeded with that recap
and a "welcome back" greeting, so the trainer continues instead of starting over.

**Completion:** `POST /sessions/:id/end` marks the lesson complete and awards its
CPD points to the lawyer's `lifetime_points` exactly once (`store.awardCpdPoints`,
audit-logged).

**API surface:**
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/trainer/sessions` | lawyer | start **or** resume (auto-detected) |
| POST | `/trainer/sessions/:id/pause` | lawyer | stop midway, keep progress |
| POST | `/trainer/sessions/:id/end` | lawyer | finish → complete + award CPD |
| GET | `/trainer/progress/mine` | lawyer | my learning across all lessons |
| GET | `/trainer/progress/:lessonId` | lawyer | one lesson (resume button + preview) |
| GET | `/trainer/lessons/:id/learners` | admin | everyone studying a lesson |
| GET | `/trainer/overview` | admin | per-lesson learner/completion rollup |

The resume recap is a heuristic (transcript tail + objectives) today — a clean
seam (`trainerStore.buildResumeContext`) to swap in a Claude-generated summary later.

---

## 1. Vendor research — who builds the realistic avatar

The market splits into two groups: vendors that render a beautiful talking
**face**, and the one vendor whose avatar also **sees the attendee back**. Your
spec ("if they look distracted, say so; if they pick up the phone, tell them; if
they look happy, recognise it") needs the second group.

| Vendor | Realism | Sees the attendee? | ElevenLabs voice | Latency | Notes |
|---|---|---|---|---|---|
| **Tavus** ⭐ | Photoreal (Phoenix-3) | **Yes — Raven-1 perception** (gaze, posture, phone, emotion, presence) | Yes (TTS layer) | <1s, sub-100ms perception | The only one that natively delivers your camera-engagement requirement. CVI = one real-time stream. Dev-first API. |
| **Anam (CARA-3)** | #1 on 2025 realism benchmark | No (renders face from audio only) | Native integration | <1s | Best pure realism + easiest ElevenLabs wiring. We'd add perception ourselves. |
| **HeyGen LiveAvatar** | Photoreal | No | Official LiveAvatar integration | Low | Most enterprise-proven (SOC 2, GDPR). Old "Interactive Avatar" sunsets 31 Mar 2026. |
| **Beyond Presence** | Photoreal | Partial (expressions) | Compatible | <100ms | Strong emotional expressions. |
| **D-ID** | Photoreal | No | Compatible | Low | Enterprise streaming, kiosk/agent focus. |
| **Soul Machines** | 3D animated (not photoreal) | Reactive face | Compatible | — | Branded characters, not "a real person". |

**Decision: Tavus.** Raven-1 unifies object recognition (e.g. a phone in hand),
emotion detection, gaze and "ambient awareness" (presence, key actions) into one
real-time context stream fed to the model — which is exactly the
distracted / phone / happy behaviour you asked for, out of the box rather than
bolted on. We use ElevenLabs as the voice layer inside the Tavus persona.

Sources: Tavus Raven-1 launch (BusinessWire, Feb 2026), Tavus Perception docs,
Anam CARA / ElevenLabs integration, ElevenLabs LiveAvatar docs, Avatar Benchmark 2025.

### Pricing (as of mid-2026, verify before contracting)
- Tavus CVI: Free 25 min · Starter $59/mo (100 min, 3 concurrent) · Growth
  $397/mo (1,250 min, 15 concurrent) · ~$0.37/min overage. Enterprise = custom
  concurrency + SLA. Budget on **concurrent attendees**, not just minutes.
- ElevenLabs: separate per-character/credit voice billing.

---

## 2. How it works (architecture)

```
Attendee browser — frontend/ai-trainer.html
  ├─ <iframe src=conversation_url>  ← Tavus CVI stream (avatar video + audio)
  │     • attendee camera + mic flow INTO this room
  │     • Raven perceives the attendee here, in real time
  │     • the avatar reacts (distracted / phone / happy) via the persona prompt
  └─ "What your trainer sees" panel  ← live perception signal / demo simulation

LAD backend (Node/Express)  — all API keys stay here
  ├─ services/tavus.js        Tavus client + the persona (behaviour + perception)
  ├─ services/trainerStore.js lessons (knowledge base) + session log
  ├─ routes/trainer.js        REST API (status, lessons, sessions, callback)
  └─ POST /trainer/callback   Tavus webhook → perception events + engagement summary

Tavus CVI            ElevenLabs
  Phoenix (face)  +    voice     +   Raven (perception)  +  Sparrow (turn-taking)
```

**The "fully AI-generated trainer on my content" part:** an admin uploads lesson
material (`trainer_lessons`). Each lesson's text becomes the `conversational_context`
injected when a session starts, so the avatar teaches *your* curriculum, not
generic answers. The persona system prompt enforces "teach only from this material".

**The camera-engagement part:** the persona's perception layer runs Raven-1 with
continuous `ambient_awareness_queries` ("is the participant distracted / on a
phone / confused / happy / absent?"). Raven's answers are fed to the model every
turn; the system prompt tells the trainer how to react. At end-of-call,
`perception_analysis_queries` produce an engagement summary we store on the
session — which can drive CPD attendance/quality scoring.

### Data flow for one session
1. Attendee picks a lesson, gives camera/mic consent, clicks **Begin**.
2. Frontend → `POST /api/v1/trainer/sessions {lessonId}`.
3. Backend builds the lesson context, calls Tavus `POST /v2/conversations`,
   stores the session, returns `conversation_url`.
4. Frontend embeds `conversation_url` — the live 1-2-1 begins.
5. Tavus posts perception/transcript events to `/trainer/callback` throughout.
6. Attendee clicks **End** → `POST /sessions/:id/end` → Tavus conversation ends,
   engagement summary persisted.

---

## 3. What's already built

Backend (`backend/`):
- `src/config.js` — `tavus` + `elevenlabs` config blocks (env-driven).
- `migrations/004-ai-trainer.sql` — `trainer_lessons`, `trainer_sessions`.
- `src/services/tavus.js` — Tavus client; the persona definition (system prompt,
  perception queries, ElevenLabs voice layer); conversation create/end.
- `src/services/trainerStore.js` — lessons + sessions data layer.
- `src/routes/trainer.js` — REST API, mounted at `/api/v1/trainer`.
- `scripts/create-trainer-persona.js` — one-time persona setup helper.

Frontend (`frontend/`):
- `ai-trainer.html` — the attendee experience: lesson picker, consent gate, live
  avatar stage, real-time "what your trainer sees" panel. Falls back to a clearly
  labelled **simulation** (local camera + scripted coaching) when Tavus isn't
  configured, so the UX is demonstrable today.
- `api-client.js` — `trainer*` methods, with localStorage demo fallback.

Everything runs in **demo mode** with zero keys. Add keys to go live.

### Go-live checklist
1. Create a Tavus account; pick/clone a **replica** (the avatar's face & default voice).
2. Backend `.env`:
   ```
   TAVUS_API_KEY=...
   TAVUS_REPLICA_ID=r...
   ELEVENLABS_API_KEY=...           # optional — overrides the replica voice
   ELEVENLABS_VOICE_ID=...
   PUBLIC_API_BASE=https://your-api # so Tavus can reach /trainer/callback
   ```
3. `node scripts/create-trainer-persona.js` → copy the printed `persona_id` into
   `TAVUS_PERSONA_ID`, redeploy.
4. Sign in as `lad_admin`, upload lessons (`PUT /api/v1/trainer/lessons`).
5. Open `ai-trainer.html` — the pill flips from **Demo** to **● Live avatar**.

---

## 4. Privacy & compliance (UAE PDPL) — decide before launch

Recording/analysing an attendee's face and emotions for a government legal body
is sensitive processing. The build already includes an explicit consent gate, but
before production confirm:
- **Lawful basis & consent** wording with LAD legal/DPO; surface it in `privacy.html`.
- **Retention** of camera-derived data. Tavus processes the video stream; decide
  whether `TAVUS_ENABLE_RECORDING` is ever on (default: off). We store only the
  *text* engagement summary, not video.
- **Data residency** of the Tavus/ElevenLabs processing region.
- **Right to decline camera** while still receiving audio-only training.

> Alternative if camera video must never leave the device: keep Tavus for the
> avatar but move perception **on-device** with MediaPipe (face/gaze/gesture +
> phone object detection) and feed only text signals to the model. Higher build
> cost, strongest privacy posture.

---

## 5. Roadmap beyond the prototype

- **Admin lesson studio**: a UI in `lad-admin.html` to upload/curate lessons
  (today it's the `PUT /trainer/lessons` API).
- **Content → lesson pipeline**: ingest PDFs/decks, auto-chunk into lessons.
- **CPD integration**: award points from an engaged, completed session via the
  existing `credit_transactions` flow; gate on the engagement score.
- **Custom Daily embed**: swap the prebuilt iframe for `@tavus/cvi-ui` /
  `daily-js` to render the live perception signal natively in the side panel.
- **Knowledge base / RAG**: for large curricula, attach Tavus document knowledge
  base instead of inlining lesson text as context.
- **Arabic delivery**: replica + ElevenLabs Arabic voice; `language: 'arabic'`
  is already wired per-lesson.
