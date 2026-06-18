'use strict';

// ─────────────────────────────────────────────────────────────────────
// Maryam — local fallback assistant.
//
// When AiModel (and Claude) are unavailable, Maryam still answers the core
// CLPD questions from the lawyer's REAL record + the live catalogue, so the
// assistant is never dead. The moment AiModel is reachable again, lex.js uses
// it instead and this is bypassed.
// ─────────────────────────────────────────────────────────────────────

const db = require('../db');
const store = require('./store');

const TARGET = 16;

function lawyerFor(reqUser) {
  if (!reqUser) return null;
  try {
    if (reqUser.user_type === 'lawyer') return store.getLawyerById(reqUser.sub);
    if (reqUser.email) return store.getLawyerByEmail(reqUser.email);
  } catch (_) {}
  return null;
}

function completedTitles(lawyer) {
  const out = new Set();
  try {
    for (const b of (store.getLawyerBookings(lawyer.id) || [])) {
      if (['booked', 'attended', 'completed'].includes((b.status || '').toLowerCase())) {
        out.add((b.course_title || b.course_title_current || '').toLowerCase());
      }
    }
  } catch (_) {}
  try {
    for (const r of db.prepare('SELECT course_title FROM cpd_records WHERE lawyer_id = ? OR LOWER(attendee_email) = LOWER(?)').all(lawyer.id, lawyer.email || '')) {
      out.add((r.course_title || '').toLowerCase());
    }
  } catch (_) {}
  out.delete('');
  return out;
}

// Live accredited catalogue (approved submissions).
function catalogue() {
  try {
    return db.prepare("SELECT * FROM accreditations WHERE status='approved' AND accreditation_code IS NOT NULL ORDER BY reviewed_at DESC LIMIT 60")
      .all().map((r) => { let p = {}; try { p = JSON.parse(r.payload || '{}'); } catch (_) {}
        return { code: r.accreditation_code, title: p.courseTitle || p.course || p.title || r.ref,
          points: r.final_points != null ? r.final_points : (p.pointsRequested || 2),
          provider: p.providerName || p.firm || '' }; });
  } catch (_) { return []; }
}

// Seeded mandatory courses.
function mandatoryCourses() {
  try {
    return db.prepare("SELECT id, title, pts, format FROM courses WHERE active=1 AND LOWER(type)='mandatory' ORDER BY format, title").all();
  } catch (_) { return []; }
}

function daysToYearEnd() {
  const now = new Date();
  const dec31 = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  return Math.max(0, Math.ceil((dec31 - now) / 86400000));
}

function statusLine(points, needed, days, name) {
  if (needed <= 0) return `You're fully compliant — **${points}/${TARGET} points** for this cycle. Nicely done${name ? ', ' + name : ''}.`;
  return `You're at **${points}/${TARGET} points**${name ? ', ' + name : ''} — **${needed} to go**, with **${days} days** left until 31 December.`;
}

// Pick courses (highest points first) until the gap is covered.
function coverGap(needed, completed) {
  const picks = []; let acc = 0;
  for (const c of catalogue().filter(c => !completed.has((c.title || '').toLowerCase())).sort((a, b) => (b.points || 0) - (a.points || 0))) {
    if (acc >= needed) break;
    picks.push(c); acc += Number(c.points) || 0;
  }
  return { picks, acc };
}

// Returns a markdown answer string, or null if we genuinely can't help.
function respond(reqUser, messages) {
  const last = [...(messages || [])].reverse().find(m => (m.role || 'user') === 'user');
  const q = (typeof last?.content === 'string' ? last.content
    : Array.isArray(last?.content) ? last.content.map(c => c.text || '').join(' ') : '').toLowerCase().trim();

  const lawyer = lawyerFor(reqUser);
  const name = lawyer ? (lawyer.first_name || '') : '';
  const points = lawyer ? (Number(lawyer.lifetime_points) || 0) : 0;
  const needed = Math.max(0, TARGET - points);
  const days = daysToYearEnd();
  const completed = lawyer ? completedTitles(lawyer) : new Set();

  const fmtList = (arr) => arr.map(c => `- **${c.title}** — ${c.points || 2} pt${(c.points || 2) === 1 ? '' : 's'}${c.provider ? ` · ${c.provider}` : ''}`).join('\n');

  // ── Intent: missing mandatory ──
  if (/mandatory|compulsory|required course|which.*missing|what.*missing/.test(q)) {
    const mand = mandatoryCourses();
    const outstanding = mand.filter(c => !completed.has((c.title || '').toLowerCase()));
    if (!mand.length) return `${statusLine(points, needed, days, name)}\n\nI can't see the mandatory list right now, but every lawyer needs the LAD mandatory modules (AI Governance, Responsible Use of AI) plus accredited points to reach 16.`;
    if (!outstanding.length) return `Great news — you've cleared **all mandatory courses**. ${statusLine(points, needed, days, name)}`;
    return `${statusLine(points, needed, days, name)}\n\n**Mandatory courses still outstanding:**\n${fmtList(outstanding.map(c => ({ title: c.title, points: c.pts })))}\n\nThe e-learning ones you can start immediately from the catalogue.`;
  }

  // ── Intent: fastest / which courses / fill the gap ──
  if (/fast|quick|soon|16|reach|fill|gap|which course|what course|recommend|book/.test(q)) {
    if (needed <= 0) return `${statusLine(points, needed, days, name)} No more courses needed this cycle — though refreshers keep your skills current.`;
    const { picks, acc } = coverGap(needed, completed);
    if (!picks.length) return `${statusLine(points, needed, days, name)}\n\nThere aren't accredited courses in the catalogue yet to recommend — check back shortly, or take the mandatory e-learning modules to start banking points.`;
    return `${statusLine(points, needed, days, name)}\n\n**Fastest route to ${TARGET} — book these ${picks.length}** (≈${acc} points):\n${fmtList(picks)}\n\nThe e-learning ones start instantly; face-to-face sessions are seat-limited, so book early.`;
  }

  // ── Intent: study plan / schedule ──
  if (/plan|schedule|90.?day|roadmap|timeline|spread/.test(q)) {
    if (needed <= 0) return `${statusLine(points, needed, days, name)} You don't need a catch-up plan — you're compliant.`;
    const { picks } = coverGap(needed, completed);
    if (!picks.length) return `${statusLine(points, needed, days, name)}\n\nI'll build a full plan once accredited courses are live in the catalogue. For now, start the mandatory e-learning modules this week.`;
    const weeks = Math.max(1, Math.ceil(days / 7));
    const plan = picks.map((c, i) => `- **Week ${Math.min(weeks, (i * 2) + 1)}:** ${c.title} (+${c.points || 2})`).join('\n');
    return `${statusLine(points, needed, days, name)}\n\n**Your study plan:**\n${plan}\n\nSpread across the weeks ahead so you avoid a year-end crunch. Want me to prioritise differently — by topic or by your skills gap?`;
  }

  // ── Intent: greeting / capabilities ──
  if (/^(hi|hello|hey|salam|help|what can you|who are you|maryam)/.test(q) || q.length < 4) {
    return `Hello${name ? ', ' + name : ''} — I'm **Maryam**, your CLPD compliance assistant. ${statusLine(points, needed, days, name)}\n\nI can help you:\n- find the **fastest courses** to reach 16 points\n- see which **mandatory courses** you still need\n- build a **study plan** to the deadline\n\nWhat would you like to do?`;
  }

  // ── Default: status + nudge ──
  if (lawyer) {
    return `${statusLine(points, needed, days, name)}\n\nAsk me for the **fastest courses to 16 points**, your **outstanding mandatory courses**, or a **study plan** and I'll map it out from your record.`;
  }
  return `I'm Maryam, your CLPD assistant. I can help with courses, mandatory requirements and study plans toward your 16 points. Ask me "what courses get me to 16 fastest?" to begin.`;
}

module.exports = { respond };
