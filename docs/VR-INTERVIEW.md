# VR client interview — runbook

A meeting room that opens in the Meta Quest browser from a link
(`freelance.legalaffairstraining.com/trainer-vr`). The lawyer sits across a
desk from a client, talks to them, and gets a marked debrief at the end.

| Part | What does it |
|---|---|
| The room | `freelance/trainer-vr.html` — WebXR (three.js). The room is a 360° photograph of a law library, `frontend/img/vr-library.jpg` (8K) with `vr-library-4k.jpg` for headsets that cannot hold the larger texture; a plain built room is the fallback. |
| The client's face | Anam (`ANAM_API_KEY`, `ANAM_VR_AVATAR_ID` or `ANAM_AVATAR_ID`) |
| The client's voice, ears and brain | An ElevenLabs conversational agent (`ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`), with Claude chosen as the agent's model |
| The debrief | Claude, through the backend's existing Anthropic settings |

The headset holds no keys. `POST /api/v1/trainer/vr/session-token` fetches an
ElevenLabs signed URL and mints a short-lived Anam session token that carries
it; Anam connects to the agent server-side. `POST /api/v1/trainer/vr/debrief`
takes the transcript the headset heard and returns four scores, one strength
and one thing to work on. Nothing from the interview is stored.

## Switch it on

1. In ElevenLabs, create a conversational agent. Model: a Claude model. Voice:
   the Department's trainer voice. System prompt: the one below. Copy the agent ID.
2. On the `lad-freelance-api` App Service, add `ELEVENLABS_AGENT_ID`, and
   `ANAM_API_KEY` if it is not already there (`ELEVENLABS_API_KEY` already is).
   Optional: `ANAM_VR_AVATAR_ID` for a different face.
3. Sign in to the portal on the headset and open `/trainer-vr`.
   `GET /api/v1/trainer/vr/status` reports `ready: true` once both are set.

`?demo=1` runs the room with a stand-in client and a sample debrief, no keys.
`?turn=<degrees>` rotates the photograph; `?seat=<metres>` moves the client.

## The client — starting prompt for the ElevenLabs agent

```
You are Khalid, 52, owner of a family trading company in Dubai. You are meeting
a lawyer for the first time. You are the CLIENT, never the lawyer, and you never
give legal advice or break character.

Your matter: your landlord has served notice that the rent on your company's
warehouse will rise by 40 per cent at renewal in three months. You signed the
lease six years ago. You think the increase is unlawful but you are not sure,
and you are worried about cash flow and about your 14 staff.

How you behave:
- Speak naturally and briefly, one or two sentences at a time, then stop and listen.
- You are polite but anxious, and a little impatient. You have been let down by
  a lawyer before who never returned calls.
- Give facts only when asked. Do not volunteer the lease dates, the notice, or
  that you already replied angrily to the landlord by WhatsApp unless the lawyer
  asks the kind of question that would bring it out.
- If the lawyer does not mention fees within a few minutes, ask what this will cost.
- If the lawyer uses jargon, ask what it means. If they are warm and clear, relax.
- Reply in the language the lawyer speaks to you: English, or Gulf (Emirati) Arabic.
- When the lawyer closes the meeting, thank them and say goodbye.

Open with: "Thank you for seeing me. I have a problem with my landlord and I
don't know where I stand."
```
