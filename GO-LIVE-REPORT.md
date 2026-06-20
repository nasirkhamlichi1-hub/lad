# CLPD Platform — Pre-Go-Live Sweep Report
_Generated overnight, 20 Jun 2026. Three parallel deep audits (security, real-data, functional) + manual verification._

---

## ✅ Fixed & merged tonight (PR #59 and earlier)
- **Fabricated figures removed**: invented national stats in the Lex assistant context ("1,842 / 4,411 lawyers, 156 firms, 92.8% compliance") in firm + lawyer portals; stale `"AED 12,600 available"` tile sub; `"4,411 practitioners / 499 firms"` strings in config and backend `CONTENT_DEFAULT`.
- **Provider data-loss bug**: registration silently dropped the **required trade-licence number** + entity type (`obj.legalForm/licence` vs form fields `entityType/tradeLicence`). Fixed.
- **XSS**: escaped firm names in the super-admin Intelligence firm table (`renderFirms`) — they flowed from the API into `innerHTML`/`onclick` unescaped and auto-render on load.

---

## 1. SECURITY

### Backend fundamentals — SOLID (verified, no action)
- **No hardcoded secrets** anywhere (no API keys, tokens, passwords committed).
- **No SQL injection** — every query uses better-sqlite3 prepared statements; no user input interpolated into SQL.
- **JWT** — production will not boot with the dev-default secret (`validateEnv.js` hard-fails in prod; `server.js` exits 1).
- **No IDOR** — firm endpoints use `effectiveFirmId()` which forces a firm CO / lawyer to their OWN firm id regardless of URL param, plus explicit ownership checks.

### The real gap: stored XSS (cross-tenant / provider data -> innerHTML)
Team has a correct `esc()` pattern (lad-messages.js, lad-crm.html, ai-assistant.js, command-centre.html, notifications-bell.js are CLEAN). Problem is inconsistency. Fix: hoist one quote-escaping `escapeHtml` to module scope per file and route every dynamic name/title/body/email through it, including inside `onclick`/`title`. Locations:
- **lad-intelligence-v4.html** (highest — super-admin, auto-renders): renderFirms 1860-70 (fixed); openFirmDeepDive 2202-03/2232-33/2466-79; renderOpsFeed ~1706; 3090-92.
- **firm-compliance-portal.html**: renderLawyerRow 2417-18; renderBookings 2998-3004; courseGrid 2941/2956-60; applications 4294-4306; insights 3197-3206; mass-book 2507/2544/2689/4497; internal sessions 3821-66.
- **lawyer-portal-v2.html**: catCardHTML 3574/3603; renderCatCalendar 3650; renderSessions 4102; paintCompletedList 3437-38; 4998-99/5103.
- **lad-admin.html**: audit 1912-13; loadStatus 2054-63; admBookingsRender 4255-61; admPurchasesRender 4411-13.
Also add a Content-Security-Policy header on the static host as defence-in-depth.

---

## 2. REAL DATA

### Remaining fabricated (must-fix)
- **lad-intelligence-v4.html KPI deep-dive panels (~line 2254+)**: hard-coded fake stats ("3492/197 below 8 points", "34% Tax / 28% Immigration", "Down from 235 in April"). Render on KPI drill-down; contradict live data. Wire to `/admin/oversight` + `/admin/points-distribution` or blank the invented specifics.

### Verify (live-overwrite assumed, confirm)
- Landing hero `stat_*` (4411/499/69) overwritten by `loadHeroStats()` live — confirm it fires in prod and the prod `content` table has no stale rows (admin -> Content can clear).
- `feedback.json` is a real exported snapshot used only as API-down fallback — acceptable but frozen.

### Acceptable (already neutralised)
Demo arrays gated behind `LAD.enabled=false`; zeroed FIRMS/COURSES fallbacks rendering "—"; `Math.random()` only for IDs/3D geometry; real tariffs (AED 120/credit). No backend endpoint returns fabricated data as real.

---

## 3. FUNCTIONAL QA

### Must-fix: self-service password reset hits non-existent endpoints (404)
`api-client.js:260/262` call `POST /auth/request-reset` and `/auth/reset-password` — neither exists in `auth.js`. Breaks "Forgot password?" on provider-portal and all of reset-password.html. Implement: single-use token table (~1h expiry); request-reset always returns 200 + emails a link via the existing mailer; reset-password validates token + sets new hash. ~1-2 hrs; security-sensitive so left unbuilt overnight. Interim: hide the link, rely on admin-driven reset in users-admin (works).

### Minor / dead code
- lawyer-portal-v2.html:853-854 `startSkillsQuiz`/`closeFirstLogin` undefined (inside hidden overlay — unreachable).
- lad-intelligence-v4.html course/trainer comparison fns (~2872-2923) target removed DOM — no-op.
- lad-accreditation-review.html:1017 `refreshScoringTotals` dead.
- help.html prose references reset + `/admin/reset-to-zero`/`/admin/db-stats` that don't exist — update copy.

### Verified CLEAN
firm-compliance-portal, lad-crm, command-centre, lad-accreditation-review (uses correct `PATCH /accreditations/:ref`), users-admin, and the entire Maryam messages + satisfaction + escalation + happiness flow. No broken page links.

---

## 4. GO-LIVE CHECKLIST
1. [HIGH] Build the two password-reset endpoints (or hide the link).
2. [HIGH] Wire/blank the Intelligence KPI deep-dive fabricated panels.
3. [MED] Complete the XSS escaping pass (section 1) + add CSP header.
4. [MED] Confirm prod `content` table clean; confirm `loadHeroStats` live.
5. [LOW] Clean dead code / stale help copy.
6. Smoke-test on prod: login each role; book a course; submit + review accreditation (activity AND provider); Maryam -> rate; Intelligence happiness + pace colours.

---

## 5. INNOVATION ROADMAP

**Effortless & predictive compliance**
1. **"Will I make it?" personal pace forecast** — turn the firm pace model into per-lawyer projections ("you'll finish ~12 Nov; book 1 more to be safe") with one-tap booking of the exact gap-closing courses.
2. **Auto-pilot booking** — CO sets "keep everyone on-track"; system holds seats / recommends for anyone drifting behind pace, approval-only.
3. **Pace-based reminders** — nudge only when a lawyer slips behind their personal pace line, with the specific fix. Less noise, higher completion.

**Leverage existing data**
4. **Proactive Maryam** — weekly per-firm digest ("3 lawyers slipped this week; here's the 2-course plan") from oversight data.
5. **Real opt-in benchmarking** — firm vs anonymised peers of similar size on pace/speed/mix. The honest version of "Tier-1 median," from live data.
6. **Course-quality loop** — feed the new happiness ratings + feedback into recommendations and provider scorecards.

**For the regulator (LAD)**
7. **Predictive DG view** — "projected year-end compliance + which firms will miss without intervention" with one-click targeted outreach (plumbing already exists).
8. **Provider accreditation analytics** — which providers score well, renewal pipeline, time-to-decision SLAs (now that provider/activity rubrics are split).
9. **Capacity/demand matching** — cross the at-risk cohort with open seats to auto-suggest new sessions.

**Trust, accessibility, reach**
10. **Verifiable digital CLPD certificate** (QR/signed) lawyers can share.
11. **Arabic-first + mobile** — fully Arabic UI + mobile "my points / book / rate".
12. **Calendar + email/SMS integration** — push bookings + reminders to where lawyers already work.

Highest ROI first: #1 (personal pace forecast), #7 (predictive DG view), #5 (real benchmarking).
