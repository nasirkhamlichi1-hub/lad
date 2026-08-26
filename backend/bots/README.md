# Learning bots

One JSON file here = one AI teacher. Adding a bot is a **config action**: no
code change, no migration, no new page.

## Add a bot

```sh
cd backend
npm run new-bot -- --id=contract-coach --name="Layla" \
                   --avatar=42675ef1-2342-45d8-9603-9bd92ed45699 \
                   --tagline="Contract drafting, one clause at a time"
```

Then restart the API. The bot appears in `GET /api/v1/trainer/bots` and at
`/learning-bot.html?bot=contract-coach`.

`npm run new-bot -- --help` lists every option. You can also just copy an
existing file in this directory and edit it — the script only writes JSON.

## Where the avatar comes from

Browse faces at <https://anam.ai/docs/personas/avatars/gallery>, then set
`avatarId` (and optionally `voiceId`).

Resolution order, first match wins:

1. `BOT_<ID>_AVATAR_ID` / `BOT_<ID>_VOICE_ID` env vars — the id upper-cased with
   hyphens as underscores, e.g. `BOT_CONTRACT_COACH_AVATAR_ID`
2. the `avatarId` / `voiceId` in this file
3. the platform default (`ANAM_AVATAR_ID`)

Leaving `avatarId` empty is fine: the bot borrows the default face, works
immediately, and the UI flags it as "no avatar of its own yet". Use the env
override when you would rather not commit the id.

## Fields

| Field | Meaning |
|---|---|
| `id` | lowercase-hyphen; also the `?bot=` value. Required. |
| `name` | the name the avatar answers to — this is `personaConfig.name`. Required. |
| `tagline` | one line under the name |
| `description` | a sentence for the bot's card |
| `avatarId` / `voiceId` | the Anam face and voice (see above) |
| `persona` | WHO the bot is. Prepended to the teaching charter. |
| `charter` | HOW it teaches. A key into `CHARTERS` in `services/trainerPrompt.js`, or literal charter text. Defaults to `clpd-trainer`. |
| `greeting` | a scripted opening line; omit to let the brain open |
| `courseId` | restrict the bot to one course's lessons; `null` = the whole library |
| `awardsCpd` | whether completing a lesson awards CPD points |
| `perception` | whether the camera is used |
| `active` | `false` hides the bot without deleting it |

## What every bot shares

The lesson library, the Claude brain, coverage tracking, progress and resume,
the CPD award, and the page. Only the face, voice and persona differ — which is
why the tenth bot costs the same as the second.

Prefer a new `persona` over a new `charter`. The charter is the constant
training method; a bot that teaches *differently* is rare, a bot that *is
someone else* is the normal case.

## How a session hangs together

```
learning-bot.html?bot=<id>
  → POST /trainer/sessions           {botId}  → session row remembers bot_id
  → POST /trainer/anam/session-token {sessionId} → that bot's face, minted server-side
  → POST /trainer/turn               {sessionId} → brain uses that bot's persona
```

The bot is resolved once at session start and persisted. Every later turn reads
it back from the session, so the browser cannot swap teacher mid-session.
