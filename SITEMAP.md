# CLPD Platform — Navigation & Flow

The platform serves **four distinct roles** plus an external-provider application flow. Each role has its own focused nav. There is no longer a "portal switcher" exposing every role to every user.

```
                  ┌──────────────────────────────┐
                  │  Public site / Sign in       │
                  │  clpd-portal.html (= index)  │
                  └─────────────┬────────────────┘
                                │
                                ▼
                  ┌──────────────────────────────┐
                  │       router.html            │
                  │  reads role → redirects      │
                  └────┬──────┬──────┬──────┬────┘
                       │      │      │      │
       ┌───────────────┘      │      │      └────────────────┐
       │                      │      │                       │
       ▼                      ▼      ▼                       ▼
 ┌─────────┐          ┌──────────┐ ┌──────────┐         ┌──────────┐
 │ Lawyer  │          │ Firm CO  │ │LAD Staff │         │LAD Admin │
 └─────────┘          └──────────┘ └──────────┘         └──────────┘
```

External training providers (companies that *aren't* a Dubai law firm) apply at `provider-portal.html` directly — that flow does not go through the role router.

---

## Role 1 — Lawyer

**Lands on:** `lawyer-portal-v2.html`
**Top nav:** `Dashboard · Browse courses · My bookings · Skills · History · Lex AI`

Lawyers do **not** see accreditation anywhere. They book courses, track points toward the 16-point CLPD cycle, view their skill graph, and chat with the Lex AI coach. That's it.

Pages in this track:

| Page | What it is |
|------|-----------|
| `lawyer-portal-v2.html` | Main dashboard — compliance progress, course catalogue, calendar, AI coach |
| `lawyer-skills.html`   | Personal skill graph derived from completed courses |

---

## Role 2 — Firm Compliance Officer

**Lands on:** `firm-compliance-portal.html`
**Top nav:** `Overview · My lawyers · Capabilities · Bookings · Credits · Apply for accreditation →`

Two primary jobs:
1. **View and manage the firm's lawyers** — see who's compliant, who's at risk, who's critical; book courses on their behalf; assign credits from the firm pool.
2. **Apply for accreditation** — the `Apply for accreditation →` link is a gold CTA pill that opens `provider-portal.html` (Forms A1 and A2). This is for firms running internal training that they want recognised as CLPD-eligible.

Pages in this track:

| Page | What it is |
|------|-----------|
| `firm-compliance-portal.html` | Firm overview, lawyer list, bookings, credits |
| `firm-capabilities.html`      | Aggregate firm capability map — search "who's trained on DIFC arbitration?" |
| `provider-portal.html`        | A1 (provider registration) + A2 (course accreditation) forms — opened from "Apply for accreditation →" |

---

## Role 3 — LAD Staff (oversight + sign-off)

**Lands on:** `lad-intelligence-v4.html`
**Top nav (purple, `.lgn` shell):** `Dashboard · Firms · Lawyers · Accreditation · Heatmap · Reports` + `LAD Admin →`

LAD Staff have the **top-down view of the profession** and **sign off accreditation** applications. The new nav is a single coherent group instead of the old four-tab strip that mixed staff and admin work.

Pages in this track:

| Page | What it is | Top-nav link |
|------|-----------|--------------|
| `lad-intelligence-v4.html`        | City-wide intelligence dashboard (4,411 lawyers, 499 firms) | Dashboard |
| `lad-intelligence-v4.html#firms`  | List of all registered firms                                | Firms     |
| `lad-intelligence-v4.html#cohort` | Cohort analysis of lawyers                                  | Lawyers   |
| `lad-accreditation-review.html`   | Review and sign off A1/A2 applications                       | Accreditation |
| `lad-capability-heatmap.html`     | Profession-wide capability heatmap by domain × topic         | Heatmap   |
| `lad-intelligence-v4.html#reports`| Analytics, exports, DG report                                | Reports   |

A secondary pill `LAD Admin →` in the top-right lets a staff member (who is granted both roles) switch into the operational view.

---

## Role 4 — LAD Admin (operations)

**Lands on:** `lad-admin.html`
**Top nav (amber/`.lgn` shell):** `Bookings · Purchases · Schedules · Website · Support` + `LAD Staff →`

Day-to-day operational work. No sign-off authority, no profession-wide analytics. Five tabs:

| Tab | What it does | Backend wiring |
|-----|-------------|----------------|
| **Bookings**   | View every booking; book a lawyer onto a course on their behalf; mark attendance; refund credits | `/api/v1/bookings` |
| **Purchases**  | Every credit purchase, refund, and pool top-up. Reconcile, refund, flag for review.            | `/api/v1/stats/*` + credits ledger |
| **Schedules**  | Upload an Excel schedule of upcoming course sessions                                            | `/api/v1/courses/sessions/bulk` |
| **Website**    | CMS — edit portal text, FAQs, and the course catalogue                                          | `/api/v1/content`, `/api/v1/courses`, `/api/v1/faq` |
| **Support**    | Lookup and assist individual lawyers; reset accounts; resolve tickets                            | (built-in) |

The default page on load is **Bookings** (was Website).

---

## External flow — Training providers (non-firm)

`provider-portal.html` is the entry for companies like Kwintessential, the Emirates Centre of Mediation, etc. — entities that aren't a Dubai law firm but want to deliver CLPD training. They apply here directly without going through the public landing's role picker.

The same form is reachable by Firm COs via the `Apply for accreditation →` link in the firm portal. Once accredited, providers log in here as `role = provider`.

---

## What changed vs. the original

| Concern | Before | After |
|--------|-------|------|
| Top nav | Two competing shells (`.lgn` for LAD, `.lad-shared-nav` for lawyer/firm); each carried a "Portals" switcher exposing every role to every user. | Each role's portal carries **only its own** nav. Cross-role pills removed. |
| LAD pages | One four-tab group: `Intelligence · Accreditation · Admin · Heatmap` — staff and admin work mixed. | Split into **LAD Staff** (`Dashboard · Firms · Lawyers · Accreditation · Heatmap · Reports`) and **LAD Admin** (`Bookings · Purchases · Schedules · Website · Support`). |
| Lawyer portal | `Dashboard · Courses · Calendar · File Activity · Lex AI` and a portal switcher to LAD/Firm/CLPD. | `Dashboard · Browse courses · My bookings · Skills · History · Lex AI` — no portal switcher. |
| Firm portal | `Overview · Lawyers · Courses · Credits · Accreditation` with portal switcher. | `Overview · My lawyers · Capabilities · Bookings · Credits · Apply for accreditation →` — accreditation is now a gold CTA, no portal switcher. |
| Login routing | `clpd-portal.html` had three roles (lawyer/firm/provider) and the post-login URL went to `lad-super-system.html`, a 1MB hub. | Five roles (lawyer, firm, lad_staff, lad_admin, provider). Post-login goes through `router.html` which reads the role and redirects to the right portal. |
| Dev-tool leaks | Footer of `clpd-portal.html` had three pills (`LAD Admin · Firm Portal · Lawyer Portal`) so anyone could click into any role. | Footer has one `SIGN IN` and one `PROVIDER APPLICATION` link. |

---

## Backend role values (already supported)

`schema.sql` already had the right role split — only the frontend needed to catch up:

| Frontend key | Backend `staff.role` | Lands on |
|--------------|-----------------------|----------|
| `lawyer` | (lawyers table, not staff)     | `lawyer-portal-v2.html` |
| `firm`   | `firm_compliance_officer`      | `firm-compliance-portal.html` |
| `lad_staff` | `lad_intelligence`          | `lad-intelligence-v4.html` |
| `lad_admin` | `lad_admin`                 | `lad-admin.html` |
| `provider` | `provider_admin`             | `provider-portal.html` |

`router.html` accepts both the frontend key and the backend `staff.role` value, so either side can drive the redirect.
