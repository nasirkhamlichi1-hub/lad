'use strict';

// ─────────────────────────────────────────────────────────────────────
// LAD CLPD — Skills service
// ─────────────────────────────────────────────────────────────────────
// Builds the lawyer skill graph from attended bookings + course topic
// fingerprints. The skill graph is derived-on-read from skill_events,
// so the decay logic and thresholds stay tunable via skill_config.
//
// Public functions:
//   recordAttendance(bookingId)        — call when a booking flips to 'attended'
//   unrecordAttendance(bookingId)      — call on reversal (refund, no-show after)
//   computeLawyerSkills(lawyerId)      — read the skill graph for one lawyer
//   computeFirmCapabilities(firmId)    — aggregate firm-wide
//   computeProfessionHeatmap()         — UAE-wide heatmap
//   getTaxonomyTree()                  — full taxonomy as nested tree
//   getRecommendations(lawyerId)       — courses to fill gaps

const db = require('../db');

// ─── Config helpers ──────────────────────────────────────────────────

function cfg(key, dflt) {
  const row = db.prepare('SELECT value FROM skill_config WHERE key = ?').get(key);
  if (!row) return dflt;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : (row.value || dflt);
}

// Exponential decay: every (half_life_years) years, contribution halves.
function recencyMultiplier(attendedAt, now = Date.now()) {
  if (!attendedAt) return 1;
  const ms = now - new Date(attendedAt).getTime();
  if (ms <= 0) return 1;
  const years = ms / (365.25 * 24 * 3600 * 1000);
  const halfLife = cfg('decay_half_life_years', 5);
  return Math.pow(0.5, years / halfLife);
}

function bucketDepth(score) {
  if (score >= cfg('advanced_threshold', 14)) return 'advanced';
  if (score >= cfg('intermediate_threshold', 6)) return 'intermediate';
  if (score >= cfg('beginner_threshold', 2)) return 'beginner';
  return 'introductory';
}

function freshnessLabel(lastTrainedAt, now = Date.now()) {
  if (!lastTrainedAt) return 'never';
  const ms = now - new Date(lastTrainedAt).getTime();
  const months = ms / (30.44 * 24 * 3600 * 1000);
  if (months <= cfg('freshness_warning_months', 24)) return 'current';
  if (months <= cfg('freshness_stale_months', 48)) return 'stale';
  return 'critically_stale';
}

// ─── Propagation: attendance → skill events ──────────────────────────

const SELECT_BOOKING = db.prepare(`
  SELECT b.*, l.id AS lawyer_id_check
  FROM bookings b
  JOIN lawyers l ON l.id = b.lawyer_id
  WHERE b.id = ?
`);

const SELECT_COURSE_TOPICS = db.prepare(`
  SELECT topic_id, weight FROM course_topics WHERE course_id = ?
`);

const INSERT_SKILL_EVENT = db.prepare(`
  INSERT OR IGNORE INTO skill_events
    (lawyer_id, topic_id, booking_id, course_id, weight, points,
     contribution, is_self_booked, attended_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const DELETE_SKILL_EVENTS = db.prepare(`
  DELETE FROM skill_events WHERE booking_id = ?
`);

/**
 * Idempotent: replaying it for the same booking produces no extra rows
 * because of the UNIQUE (lawyer_id, topic_id, booking_id) constraint.
 *
 * Returns { eventsCreated, topics } describing what was written.
 */
function recordAttendance(bookingId) {
  const booking = SELECT_BOOKING.get(bookingId);
  if (!booking) {
    return { error: 'booking_not_found', eventsCreated: 0, topics: [] };
  }
  if (booking.status !== 'attended') {
    return { error: 'not_attended', eventsCreated: 0, topics: [] };
  }
  if (!booking.course_id) {
    return { error: 'no_course_id', eventsCreated: 0, topics: [] };
  }

  const topics = SELECT_COURSE_TOPICS.all(booking.course_id);
  if (!topics.length) {
    return { error: 'no_topics_for_course', eventsCreated: 0, topics: [] };
  }

  const points = booking.points_earned || 0;
  const isSelf = (booking.booked_by === 'self' || booking.booked_by === 'Self') ? 1 : 0;

  const tx = db.transaction((rows) => {
    let n = 0;
    for (const t of rows) {
      const contribution = t.weight * points;
      const r = INSERT_SKILL_EVENT.run(
        booking.lawyer_id, t.topic_id, booking.id, booking.course_id,
        t.weight, points, contribution, isSelf,
        booking.scheduled_at || new Date().toISOString()
      );
      if (r.changes > 0) n++;
    }
    return n;
  });

  const eventsCreated = tx(topics);
  return { ok: true, eventsCreated, topics: topics.map(t => t.topic_id) };
}

function unrecordAttendance(bookingId) {
  const r = DELETE_SKILL_EVENTS.run(bookingId);
  return { ok: true, eventsRemoved: r.changes };
}

// Bulk seeding helper — replays every attended booking. Use on first import.
function rebuildAllSkillEvents() {
  console.log('Rebuilding skill events from all attended bookings…');
  const bookings = db.prepare(`SELECT id FROM bookings WHERE status = 'attended'`).all();
  let total = 0, withTopics = 0;
  const tx = db.transaction((ids) => {
    db.prepare('DELETE FROM skill_events').run();
    for (const { id } of ids) {
      const r = recordAttendance(id);
      total++;
      if (r.eventsCreated > 0) withTopics++;
    }
  });
  tx(bookings);
  const eventCount = db.prepare('SELECT COUNT(*) AS n FROM skill_events').get().n;
  console.log(`  → ${total.toLocaleString()} attended bookings processed, ${withTopics.toLocaleString()} matched a known course, ${eventCount.toLocaleString()} skill events created`);
  return { processed: total, matched: withTopics, events: eventCount };
}

// ─── Skill graph reads ───────────────────────────────────────────────

const SELECT_LAWYER_EVENTS = db.prepare(`
  SELECT se.*, t.label, t.label_ar, t.domain, t.level, t.parent_id,
         c.title AS course_title
  FROM skill_events se
  JOIN taxonomies t ON t.id = se.topic_id
  LEFT JOIN courses c ON c.id = se.course_id
  WHERE se.lawyer_id = ?
  ORDER BY se.attended_at DESC
`);

/**
 * Returns an array of skills for one lawyer:
 *   [{ topic_id, label, domain, depth_score, depth_bucket,
 *      last_trained_at, freshness, course_count, interest_score,
 *      evidence: [{ booking_id, course_id, course_title, attended_at, contribution }] }]
 */
function computeLawyerSkills(lawyerId, opts = {}) {
  const events = SELECT_LAWYER_EVENTS.all(lawyerId);
  const now = Date.now();

  const byTopic = new Map();
  for (const e of events) {
    const r = recencyMultiplier(e.attended_at, now);
    const decayed = e.contribution * r;
    let agg = byTopic.get(e.topic_id);
    if (!agg) {
      agg = {
        topic_id:        e.topic_id,
        label:           e.label,
        label_ar:        e.label_ar,
        domain:          e.domain,
        depth_score:     0,
        course_count:    0,
        interest_score:  0,
        last_trained_at: null,
        evidence:        [],
      };
      byTopic.set(e.topic_id, agg);
    }
    agg.depth_score    += decayed;
    agg.course_count   += 1;
    agg.interest_score += e.is_self_booked ? (e.weight * r) : 0;
    if (!agg.last_trained_at || e.attended_at > agg.last_trained_at) {
      agg.last_trained_at = e.attended_at;
    }
    agg.evidence.push({
      booking_id:   e.booking_id,
      course_id:    e.course_id,
      course_title: e.course_title,
      attended_at:  e.attended_at,
      weight:       e.weight,
      contribution: decayed,
      is_self_booked: !!e.is_self_booked,
    });
  }

  const skills = [...byTopic.values()].map(s => ({
    ...s,
    depth_score:    Math.round(s.depth_score * 10) / 10,
    interest_score: Math.round(s.interest_score * 10) / 10,
    depth_bucket:   bucketDepth(s.depth_score),
    freshness:      freshnessLabel(s.last_trained_at, now),
  })).sort((a, b) => b.depth_score - a.depth_score);

  return skills;
}

/**
 * Aggregate skill graph across a firm. Returns:
 *   [{ topic_id, label, domain, total_depth, lawyers_count,
 *      avg_depth, freshest, top_lawyers: [{lawyer_id, depth_score}] }]
 */
function computeFirmCapabilities(firmId) {
  const lawyers = db.prepare(`SELECT id, first_name, last_name FROM lawyers
                              WHERE firm_id = ? AND status = 'active'`).all(firmId);
  const byTopic = new Map();
  const now = Date.now();

  for (const l of lawyers) {
    const skills = computeLawyerSkills(l.id);
    for (const s of skills) {
      let agg = byTopic.get(s.topic_id);
      if (!agg) {
        agg = {
          topic_id:      s.topic_id,
          label:         s.label,
          domain:        s.domain,
          total_depth:   0,
          lawyers_count: 0,
          freshest:      null,
          top_lawyers:   [],
        };
        byTopic.set(s.topic_id, agg);
      }
      agg.total_depth   += s.depth_score;
      agg.lawyers_count += 1;
      if (!agg.freshest || s.last_trained_at > agg.freshest) {
        agg.freshest = s.last_trained_at;
      }
      agg.top_lawyers.push({
        lawyer_id:  l.id,
        name:       `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.id,
        depth_score: s.depth_score,
        last_trained_at: s.last_trained_at,
      });
    }
  }

  return [...byTopic.values()].map(t => ({
    ...t,
    total_depth: Math.round(t.total_depth * 10) / 10,
    avg_depth:   t.lawyers_count ? Math.round((t.total_depth / t.lawyers_count) * 10) / 10 : 0,
    freshness:   freshnessLabel(t.freshest, now),
    top_lawyers: t.top_lawyers
      .sort((a, b) => b.depth_score - a.depth_score)
      .slice(0, 10),
  })).sort((a, b) => b.total_depth - a.total_depth);
}

/**
 * Profession-wide heatmap. Returns one row per topic with how many
 * practising lawyers have any depth in it.
 */
function computeProfessionHeatmap(opts = {}) {
  const rows = db.prepare(`
    SELECT t.id AS topic_id, t.label, t.domain, t.level, t.parent_id,
           COUNT(DISTINCT se.lawyer_id) AS lawyers_with_skill,
           SUM(se.contribution) AS raw_depth,
           MAX(se.attended_at) AS most_recent
    FROM taxonomies t
    LEFT JOIN skill_events se ON se.topic_id = t.id
    LEFT JOIN lawyers l ON l.id = se.lawyer_id AND l.status = 'active'
    WHERE t.active = 1
    GROUP BY t.id
  `).all();

  const totalLawyers = db.prepare(
    `SELECT COUNT(*) AS n FROM lawyers WHERE status = 'active'`
  ).get().n || 1;

  const now = Date.now();
  return rows.map(r => ({
    topic_id:       r.topic_id,
    label:          r.label,
    domain:         r.domain,
    level:          r.level,
    parent_id:      r.parent_id,
    lawyers_with_skill: r.lawyers_with_skill || 0,
    coverage_pct:   Math.round(((r.lawyers_with_skill || 0) / totalLawyers) * 1000) / 10,
    raw_depth:      Math.round((r.raw_depth || 0) * 10) / 10,
    most_recent:    r.most_recent,
    freshness:      freshnessLabel(r.most_recent, now),
  })).sort((a, b) => b.lawyers_with_skill - a.lawyers_with_skill);
}

// ─── Taxonomy tree ───────────────────────────────────────────────────

function getTaxonomyTree() {
  const all = db.prepare(`SELECT * FROM taxonomies WHERE active = 1
                          ORDER BY level, display_order, label`).all();
  const byId = new Map();
  const roots = [];
  for (const n of all) {
    byId.set(n.id, { ...n, children: [] });
  }
  for (const n of byId.values()) {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id).children.push(n);
    else roots.push(n);
  }
  return roots;
}

function getTaxonomyFlat() {
  return db.prepare(`SELECT * FROM taxonomies WHERE active = 1
                     ORDER BY domain, level, label`).all();
}

// ─── Recommendations (v1: gap-based) ─────────────────────────────────

function getRecommendations(lawyerId) {
  const skills = computeLawyerSkills(lawyerId);
  const skillMap = new Map(skills.map(s => [s.topic_id, s]));

  // Strategy:
  //   1. Refresh recommendations: skills that are stale or critically_stale
  //      where there's an active course covering that topic
  //   2. Gap recommendations: top-N most-trained topics across peers
  //      (same firm, same role) that this lawyer has no/light depth in
  //   3. Trending recommendations: topics with rising attendance
  //      profession-wide

  const lawyer = db.prepare('SELECT firm_id, role FROM lawyers WHERE id = ?').get(lawyerId);

  // 1. Refresh recommendations
  const stale = skills
    .filter(s => s.freshness !== 'current' && s.depth_score >= 2)
    .slice(0, 5);
  const refresh = [];
  for (const s of stale) {
    const course = db.prepare(`
      SELECT c.id, c.title, c.pts, ct.weight
      FROM course_topics ct
      JOIN courses c ON c.id = ct.course_id
      WHERE ct.topic_id = ? AND c.active = 1
      ORDER BY ct.weight DESC, c.pts DESC LIMIT 1
    `).get(s.topic_id);
    if (course) {
      refresh.push({
        reason:     'refresh',
        reason_detail: `Last trained ${monthsAgo(s.last_trained_at)} — refresh recommended`,
        topic_id:   s.topic_id,
        topic_label: s.label,
        course_id:  course.id,
        course_title: course.title,
        course_pts: course.pts,
      });
    }
  }

  // 2. Peer-gap recommendations
  let peerGap = [];
  if (lawyer && lawyer.firm_id) {
    const peerTopics = db.prepare(`
      SELECT t.id AS topic_id, t.label, t.domain,
             COUNT(DISTINCT se.lawyer_id) AS peer_count
      FROM skill_events se
      JOIN lawyers l ON l.id = se.lawyer_id
      JOIN taxonomies t ON t.id = se.topic_id
      WHERE l.firm_id = ? AND l.id != ? AND l.status = 'active'
      GROUP BY t.id
      ORDER BY peer_count DESC LIMIT 30
    `).all(lawyer.firm_id, lawyerId);

    for (const pt of peerTopics) {
      const mine = skillMap.get(pt.topic_id);
      if (mine && mine.depth_score >= cfg('intermediate_threshold', 6)) continue;
      const course = db.prepare(`
        SELECT c.id, c.title, c.pts
        FROM course_topics ct
        JOIN courses c ON c.id = ct.course_id
        WHERE ct.topic_id = ? AND c.active = 1
        ORDER BY ct.weight DESC LIMIT 1
      `).get(pt.topic_id);
      if (course) {
        peerGap.push({
          reason:      'peer_gap',
          reason_detail: `${pt.peer_count} colleagues at your firm have this skill`,
          topic_id:    pt.topic_id,
          topic_label: pt.label,
          course_id:   course.id,
          course_title: course.title,
          course_pts:  course.pts,
        });
      }
      if (peerGap.length >= 5) break;
    }
  }

  return {
    refresh: refresh.slice(0, 3),
    peer_gap: peerGap.slice(0, 3),
    generated_at: new Date().toISOString(),
  };
}

function monthsAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / (30.44 * 24 * 3600 * 1000));
  if (m < 1) return 'this month';
  if (m < 12) return `${m} months ago`;
  const y = Math.floor(m / 12);
  return y === 1 ? '1 year ago' : `${y} years ago`;
}

module.exports = {
  recordAttendance,
  unrecordAttendance,
  rebuildAllSkillEvents,
  computeLawyerSkills,
  computeFirmCapabilities,
  computeProfessionHeatmap,
  getTaxonomyTree,
  getTaxonomyFlat,
  getRecommendations,
  bucketDepth,
  freshnessLabel,
};
