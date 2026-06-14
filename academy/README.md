# Service Ambassador Academy — Orbit

A gamified 3D training galaxy for the Government of Dubai Legal Affairs Department.
Built on the same Orbit engine as the portfolio `command-center`, but the **11
LAD services are planets**, and each service's **steps, fees and channels are
moons**. A conversational **AI guide** teaches each service, then the trainee
passes a **knowledge quiz** and handles a **live customer simulation** that gets
scored. Certify all 11 to earn a printable **Service Ambassador certificate**.

Single self‑contained file (`index.html`); three.js from a CDN; progress saved in
`localStorage`. All service content (steps, fees, timelines, documents, channels)
is the verified data from the reception portal.

## How a trainee uses it
1. **Click a planet** → the service panel opens on **Learn**: the guide introduces
   the service, with the journey, fees table, channels and required documents. Ask
   the guide anything (type or speak).
2. **Quiz** tab → a short knowledge check. Pass (≥ 67%) to unlock the simulation.
3. **Simulation** tab → a real customer asks a question; the trainee responds by
   voice or text and is **scored 0–100** with coaching. Pass (≥ 60%) to certify
   that service.
4. A service is **certified** once its quiz *and* simulation are passed. The HUD
   tracks `n / 11`. At 11/11 the **Certificate** button unlocks.

Trainees can move **freely** between planets at any time.

## Smarter guide (optional)
Works fully offline (grounded scripted guide + keyword‑based simulation scoring).
Click the **gear** and paste a **Claude (Anthropic) key** to make the guide
conversational and have it grade simulations like a real examiner, and an
**ElevenLabs key** for a natural voice. Keys stay in the browser only.

## Deploy
Static, like `command-center`: app location `academy`, no build step. Reachable on
the shared GitHub Pages / Azure deploy at `…/academy/`.
