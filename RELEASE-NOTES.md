# Navigation Redesign — Release Notes

This bundle is a drop-in replacement for the `frontend/` and `backend/src/config.js` from the original handoff. It rewires navigation so each of the four user roles sees only its own focused top nav.

## How to deploy

```bash
# back up first
cp -r frontend frontend.backup
cp backend/src/config.js backend/src/config.js.backup

# then drop these in
cp -r <this-bundle>/frontend/* frontend/
cp <this-bundle>/backend/src/config.js backend/src/config.js
cp <this-bundle>/backend/.env.example backend/.env.example
```

Restart the backend so the new `FRONTEND_POST_LOGIN_URL` takes effect. Frontend redeploys to Netlify or Azure Static Web Apps with no build step.

## Compatibility

- **Backend:** no schema changes. Role values in `staff.role` (`lad_admin`, `lad_intelligence`, `firm_compliance_officer`, `provider_admin`) are unchanged.
- **JWT:** unchanged. `router.html` reads the same `#token=…&role=…&name=…` fragment that `auth-bridge.js` already produced.
- **API:** no changes. Bookings and Purchases tabs in `lad-admin.html` use the existing `/api/v1/bookings` endpoint and fall back to demo data when `LAD_API_BASE` isn't set.
- **localStorage keys:** unchanged (`lad_token`, `lad_role`, `lad_name`).

## Files changed

| File | Change |
|------|--------|
| `frontend/lawyer-portal-v2.html`        | Top nav simplified; portal switcher removed |
| `frontend/lawyer-skills.html`           | Added top nav (was naked) |
| `frontend/firm-compliance-portal.html`  | Reordered nav with `My lawyers` second and gold CTA for accreditation; portal switcher removed |
| `frontend/firm-capabilities.html`       | Was wrongly using LAD nav; replaced with Firm nav |
| `frontend/lad-intelligence-v4.html`     | LAD STAFF group: `Dashboard · Firms · Lawyers · Accreditation · Heatmap · Reports` |
| `frontend/lad-accreditation-review.html`| Same LAD STAFF group |
| `frontend/lad-capability-heatmap.html`  | Same LAD STAFF group |
| `frontend/lad-admin.html`               | LAD ADMIN group: `Bookings · Purchases · Schedules · Website · Support`; added Bookings + Purchases pages with CSV export |
| `frontend/clpd-portal.html`             | Role picker gets LAD Staff + LAD Admin cards; footer dev-pills removed |
| `frontend/index.html`                   | Synced with clpd-portal.html |
| `frontend/router.html` *(new)*          | Post-login router — reads role, redirects to right portal |
| `backend/src/config.js`                 | `postLoginUrl` defaults to `router.html` instead of `lad-super-system.html` |
| `backend/.env.example`                  | Same |
| `SITEMAP.md` *(new)*                    | Documents new IA, role tracks, and the backend role-key mapping |

## Files NOT changed (worth noting)

- `frontend/lad-super-system.html` (1 MB) — still functional but no longer the post-login landing page. Recommend deprecating: the new `router.html` sends each role to its own portal directly. The embedded sidebars in super-system still carry the old "Portals" switcher; leaving them as-is so the file keeps working if anyone has a deep link.
- `frontend/provider-portal.html` — already a clean standalone external-party flow; no change.
- `backend/src/routes/*` — no route changes needed.

## Validation checklist

After deploying, verify:

1. **Lawyer login** (use the demo `Yousef Al Mansouri` from the role picker, or the seeded `f.almansouri@galadari.ae` is **not** a lawyer — it's the firm CO; for lawyer use the role-picker demo). Lands on `lawyer-portal-v2.html`. Top nav shows six items, no accreditation pill, no portal switcher.
2. **Firm CO login.** Lands on `firm-compliance-portal.html`. Top nav shows `Overview · My lawyers · Capabilities · Bookings · Credits · Apply for accreditation →`. The gold CTA opens `provider-portal.html`.
3. **LAD Staff login** (new demo: `s.hashimi@legal.dubai.gov.ae` in the role picker; backend role `lad_intelligence`). Lands on `lad-intelligence-v4.html`. Top nav shows the LAD STAFF group + `LAD Admin →` switcher.
4. **LAD Admin login** (new demo: `admin@legal.dubai.gov.ae` in the role picker; backend role `lad_admin`). Lands on `lad-admin.html` with the **Bookings** tab open. Top nav shows the LAD ADMIN group + `LAD Staff →` switcher.
5. **Provider login.** Lands on `provider-portal.html`. Unchanged.
6. **Sign out** from any portal returns to `clpd-portal.html` (handled by `auth-bridge.js`'s existing `data-lad-logout` binding).

## Phase-2 follow-ups (out of scope for this redesign)

- Wire the Bookings tab's `admBookEdit` / `admBookOpen` modals to `POST /api/v1/bookings` and `PATCH /api/v1/bookings/:id`.
- Wire the Purchases tab to a `/api/v1/purchases` endpoint (currently uses demo rows).
- Either delete or deprecate `lad-super-system.html`.
- Add a dedicated `lad-firms.html` and `lad-lawyers.html` page if the in-page anchors under LAD Staff feel too thin.

---

## v3 — Follow-up edits (UAE Pass scope, AI projection, linked forecast/trajectory)

Five additional changes layered on top of the v2 redesign:

### 1. UAE Pass restricted to lawyers
- `provider-portal.html` — both UAE Pass buttons (Register + Sign in) removed; providers and firms applying for accreditation now use email + password only. The orphan `uaePassRegister`/`uaePassLogin` JS handlers are stubbed out.
- `clpd-portal.html` (and synced `index.html`) — added a UAE Pass button to the credentials step that appears **only when the Lawyer role is selected**. For firms, LAD Staff, LAD Admin, and Providers the UAE Pass block stays hidden; they sign in with email + password. New helper `doUaePassLogin()` calls the backend OIDC endpoint when wired, otherwise simulates a lawyer sign-in in static demo mode.

### 2. AI-powered compliance projection on the lawyer page
New section `#projection` injected between the KPI strip and the Lex coach in `lawyer-portal-v2.html`. It contains:
- Four headline numbers (courses needed, recommended pace, hours to invest, AI confidence) that recalculate per mode
- A custom inline SVG chart showing **three projection paths** (Steady pace, Sprint, Current pace) over May → Dec, with a 16-pt target line, a mandatory-floor reference, an animated "today" marker pulsing at the current 4 pts, course-token circles along the recommended path, and a confidence-band gradient.
- Three mode-pills above the chart (`Steady pace · Sprint · Current pace`) — each one switches the visible projection, swaps the six suggested courses below, and updates the inline Lex commentary block at the bottom.
- All client-side, no extra dependency. The controller is `projSetMode(mode)`.

### 3. Lex coach — Steady pace replaces Budget
The middle path card in the Lex Coach section now reads **"Steady pace · One course every five weeks"** instead of "Budget · All-online". Tagged in teal (matching the steady-pace mode in the projection above), with new stats (15 credits / 19h / END 5 Dec) and copy that emphasises even distribution rather than minimum spend.

### 4. LAD intelligence — Trajectory linked to Forecast in real time
Restructured `lad-intelligence-v4.html`:
- The standalone `TRAJECTORY` section has been **merged into** the Forecast/Simulator section as a live chart at the top.
- The chart's forecast curve, confidence band, endpoint dot, endpoint label, and all four KPI numbers (Dec forecast, vs 2025, gap to 96% target, status pill) now recompute on every slider input.
- New helper `updateTrajectoryFromSim(total)` is called at the end of `runSim()`. It generates an ease-out cubic curve from May to Dec, anchored to the current 10.4% on the left and the simulator's projected % on the right. SVG paths use a `transition: d 0.35s ease-out` so changes animate smoothly.
- The status pill (`▲ ON TRACK / ◆ AT RISK / ▼ OFF TRACK`) recolours based on whether the forecast clears 96%, 85%, or falls below.

### 5. Geospatial removed
The `<section id="map">` "Dubai firm density" block is gone. Sidebar's `Geographic` link removed. Command-palette and scroll-spy `sections` array updated. The single `Training Planner` sidebar item that pointed at the old simulator section has been renamed `Forecast & trajectory` to reflect the merger.
