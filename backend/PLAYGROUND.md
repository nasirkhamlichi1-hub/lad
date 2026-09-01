# Testing it locally

## One command

Double-click **`START-PLAYGROUND.cmd`**, then open **<http://localhost:4000/playground>**.

That page is the front door. It has two buttons:

| Button | What it opens | What you can do |
|---|---|---|
| **Open the learning hub** | the lawyer's course hub | Walk the journey — readings, taught sessions, the assessment. Watch the bar move. |
| **Open the topic builder** | the admin authoring page | Create a topic, see what each slot still needs, publish it. |

Each button signs you in as the matching demo user first, so nothing asks
for a password. The whole platform — API and portals — runs on one origin
in development, so there is no second server to start and no CORS to
configure.

## What to try

**As a lawyer.** The demo topic has two sections. Part 1 is sequential:
only the first reading is open, and each item unlocks the next. Part 2 is
open in any order. Open a reading, mark it done, and the completion figure
moves. Launch a taught session and it hands you to the AI trainer with
that lesson already selected — finish it and you land back in the hub with
it marked complete, because the server mirrored the session onto the spine
before it answered.

**As an administrator.** Create a topic: give it a title and say how many
documents, AI bots and SCORM packages it is made of. The slots come out
empty, and each says what it needs. Press Publish and it refuses, naming
every slot that is not ready — a lawyer should never open an empty item.
Attach content (the buttons open the tools that already own materials and
teaching content), come back, and publish.

**Things worth breaking on purpose:**

- Fail the assessment. It reads *failed*, and the bar does not move. Pass
  it on a second attempt — the best score stands, not the last one.
- Leave a reading unfinished. It reads *in progress*: starting something is
  progress, and someone who abandoned halfway should not look like they
  never turned up.
- Nothing in either page ever sends a percentage. There is no endpoint that
  accepts one — it is derived from the attempt log on every read.

## If you would rather drive it yourself

```
npm ci
npm run migrate
npm run seed:demo-spine     # builds and publishes the demo topic
npm run test:learning       # 59 checks, about two seconds
npm start
```

Re-run `npm run seed:demo-spine` at any time to reset the demo topic — it
clears its own rows first.

## Changing things

Two places account for most of what you'll want to alter:

| To change | Edit |
|---|---|
| What "finished" means for an activity type | `settleStatus()` in `src/lms/store.js` |
| The activity types themselves | `KINDS` at the top of `src/lms/store.js` |
| The demo course's shape | `scripts/seed-spine-demo.js` |
| The playground page | `playground/spine.html` |

After changing store logic, run `npm run test:learning` — 59 checks, about two
seconds. It covers fail-then-pass settlement, attempt-close idempotency,
cross-learner isolation and re-derivation after a structural change. It
caught two real bugs during the build, so it's worth keeping green.

Re-run `npm run seed:demo-spine` any time to reset the demo course; it clears
its own rows first, so it's repeatable.

## What this is not, yet

- **SCORM does not run.** The `scorm` activity in the demo behaves like any
  other — it has no player, no manifest parsing and no `cmi` data. That's
  phase 2, and the spine is what it will report into.
- **The playground is development-only.** It's mounted behind an
  `if (config.isDev)` guard, so it cannot appear on a deployed instance.
- **The database is SQLite.** Everything under `src/lms` goes through an
  async layer (`src/lms/engine.js`) so this subsystem can move to Postgres by
  changing that one file rather than the ~400 synchronous call sites the rest
  of the backend uses.
