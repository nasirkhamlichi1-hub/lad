# CLPD Admin CRM — how the team runs it, with AI at every step

This is the operating model for the CLPD admin team: how messages flow, who
handles what, and how every interaction is recorded so the inbox doubles as a
CRM. The guiding principle is **AI does the first pass at every step; humans
handle the exceptions** — and the team is never all pinged for the same thing.

---

## 1. The flow of a message

```
Lawyer / Firm sends a message
        │
        ▼
  ┌───────────────┐   Maryam (AI) reads it against the sender's LIVE data
  │  MARYAM tries │   (their points, credits, deadline, firm cohort)
  │  to resolve   │
  └──────┬────────┘
         │
   ┌─────┴───────────────────────────┐
   │                                 │
   ▼ can help                        ▼ can't help (refund, record change,
 Answers directly.                    complaint, exemption, a decision…)
 Tags category + priority.            │
 Thread → "pending".                  ▼
 NO human is paged.            Escalates: posts a hand-off note,
                               tags category + priority, and ROUTES the
                               thread to ONE owner (see §2). Only that
                               owner is notified.
```

Every message is also written to the **activity log** (§3), so the whole
exchange is on the firm's / lawyer's CRM timeline regardless of who handled it.

### Why this matters
- **~70–80% of inbound messages never reach a human** — Maryam answers status,
  points, deadline, how-to and course questions instantly from real data.
- The team only ever sees the messages that genuinely need a person, and each
  of those lands with **one named owner**, not the whole inbox.

---

## 2. Routing — one owner, never the whole team

When Maryam escalates, the system picks a single owner in this order:

1. **Firm account owner** — if the firm has an assigned relationship owner
   (`firms.account_owner`), it goes to them. This is how you give big firms a
   consistent point of contact.
2. **Category specialist** — Maryam tags every thread with a category
   (`compliance · credits · bookings · accreditation · technical · general`).
   If an admin owns that category (`staff.speciality`), it routes to them.
3. **Least-loaded admin** — otherwise it round-robins to whichever admin on
   duty has the fewest open/pending threads, so load stays even.

Only the chosen owner is emailed. The thread shows in their **"Mine"** filter in
the inbox, with `category` and a `high` flag when priority warrants it.

### Configuring routing (one-time, per admin / per firm)
- Give an admin a speciality: `UPDATE staff SET speciality='credits' WHERE …`
- Give a firm a dedicated owner: `UPDATE firms SET account_owner='<staffId>' WHERE …`
- Set neither and it just balances across the team automatically.

> A lightweight admin UI for these two settings is the natural next step; today
> they're single-column values, so they're trivial to set.

---

## 3. The CRM — every interaction recorded

Every meaningful event is written to one `activity_log` table, keyed by
`firm_id` and/or `lawyer_id`, so you can pull a complete timeline for any firm or
lawyer:

| kind            | when it's logged                              |
|-----------------|-----------------------------------------------|
| `message_in`    | a lawyer/firm opens or replies to a thread    |
| `ai_reply`      | Maryam answers                                 |
| `escalation`    | Maryam hands off to a human                    |
| `assignment`    | a thread is routed/assigned (by AI or admin)   |
| `reply_out`     | an admin replies                               |
| `status_change` | a thread is moved to pending/resolved/closed   |

Each row carries who did it (`actor_type`: requester / ai / admin / system), a
human-readable `summary`, and a link back to the conversation.

**Read it:** `GET /api/v1/messages/activity?firm_id=…` or `?lawyer_id=…`
returns the timeline (admins only). This is what powers the per-firm and
per-lawyer history in the admin CRM view.

### Extending the timeline
The same `logActivity()` helper should be called from the booking and credit
routes (`kind: 'booking'`, `'credit_purchase'`) so the CRM shows the full
commercial relationship — messages, bookings and payments — in one place. The
table and helper are already built for it; it's a one-line call at each event.

---

## 4. AI at every step — current + next

| Step                     | AI today                                   | Next |
|--------------------------|--------------------------------------------|------|
| First response           | ✅ Maryam answers from live data            | Multi-turn memory of prior threads |
| Triage / classification  | ✅ category + priority on every message     | Sentiment + churn-risk scoring |
| Routing                  | ✅ owner picked by category / account / load| Learns best-resolver per category |
| Drafting replies         | ⏳ Maryam drafts; admin sends               | One-click "Maryam, draft a reply" in the thread |
| Summarisation            | ⏳                                          | Auto-summary + suggested next action per firm |
| Reporting                | ⏳                                          | Weekly "state of the inbox" digest per admin |

The foundations (live grounding, classification, routing, activity log) are in
place, so each "next" item is an additive step rather than a rebuild.

---

## 5. Daily rhythm for an admin

1. Open the inbox → **"Mine"** shows what's routed to you, newest first, with
   `high`-priority threads flagged.
2. Maryam has already replied or handed off with context — you're never starting
   cold.
3. Reply, or change status to `resolved` when done. Every action is logged.
4. **"Unassigned"** is the safety net — anything the router couldn't place sits
   here for pickup.
5. Open any firm/lawyer's **timeline** to see the full history before you
   respond.

The inbox is the CRM: messages, AI actions, assignments and outcomes all land on
the same timeline, so the team always has the full picture of every
relationship.
