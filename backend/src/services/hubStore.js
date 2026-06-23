'use strict';

// Knowledge-hub store. One hub per course (keyed by course_id), holding the
// reference content that fronts the AI trainer: primary legislation cards and an
// FAQ. The trainer's own lessons (trainer_lessons with the same course_id) are
// the shared source of truth for the teaching material — the hub adds the
// reference layer on top, so a single course upload drives both experiences.

const db = require('../db');

function parse(value, dflt) {
  try { return value ? JSON.parse(value) : dflt; } catch (_) { return dflt; }
}

function hydrate(row) {
  if (!row) return null;
  return {
    course_id: row.course_id,
    title: row.title || '',
    eyebrow: row.eyebrow || '',
    intro: row.intro || '',
    legislation: parse(row.legislation, []),
    faq: parse(row.faq, []),
    cta_label: row.cta_label || '',
    cta_url: row.cta_url || '',
    published: !!row.published,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
  };
}

function getHub(courseId) {
  return hydrate(db.prepare('SELECT * FROM course_hubs WHERE course_id = ?').get(courseId));
}

function listHubs() {
  return db.prepare('SELECT * FROM course_hubs ORDER BY updated_at DESC').all().map(hydrate);
}

function upsertHub(hub, updatedById) {
  const courseId = String(hub.course_id || '').trim();
  if (!courseId) throw new Error('course_id is required');
  db.prepare(`
    INSERT INTO course_hubs
      (course_id, title, eyebrow, intro, legislation, faq, cta_label, cta_url, published, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT (course_id) DO UPDATE SET
      title=excluded.title, eyebrow=excluded.eyebrow, intro=excluded.intro,
      legislation=excluded.legislation, faq=excluded.faq,
      cta_label=excluded.cta_label, cta_url=excluded.cta_url,
      published=excluded.published, updated_at=datetime('now'), updated_by=excluded.updated_by
  `).run(
    courseId,
    String(hub.title || '').trim(),
    String(hub.eyebrow || '').trim(),
    String(hub.intro || '').trim(),
    JSON.stringify(Array.isArray(hub.legislation) ? hub.legislation : []),
    JSON.stringify(Array.isArray(hub.faq) ? hub.faq : []),
    String(hub.cta_label || '').trim(),
    String(hub.cta_url || '').trim(),
    hub.published ? 1 : 0,
    updatedById || null
  );
  return getHub(courseId);
}

// The teaching material the trainer uses for this course — the same content the
// hub assembles its "what you'll cover" list from. Active lessons only.
function lessonsForCourse(courseId) {
  if (!courseId) return [];
  return db.prepare(`
    SELECT id, title, summary, objectives, duration_min, cpd_points
    FROM trainer_lessons WHERE course_id = ? AND active = 1
    ORDER BY updated_at ASC
  `).all(courseId).map((r) => ({
    id: r.id, title: r.title, summary: r.summary || '',
    objectives: parse(r.objectives, []),
    duration_min: r.duration_min || 0, cpd_points: r.cpd_points || 0,
  }));
}

// Every course that has trainer lessons OR a hub — what the admin can manage.
function coursesOverview() {
  const rows = db.prepare(`
    SELECT course_id,
           COUNT(*) AS lessons,
           SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_lessons
    FROM trainer_lessons WHERE course_id IS NOT NULL AND course_id != ''
    GROUP BY course_id
  `).all();
  const byId = {};
  rows.forEach((r) => { byId[r.course_id] = { course_id: r.course_id, lessons: r.lessons, active_lessons: r.active_lessons, hasHub: false, published: false, title: '' }; });
  listHubs().forEach((h) => {
    byId[h.course_id] = Object.assign(byId[h.course_id] || { course_id: h.course_id, lessons: 0, active_lessons: 0 }, { hasHub: true, published: h.published, title: h.title });
  });
  return Object.values(byId).sort((a, b) => a.course_id.localeCompare(b.course_id));
}

module.exports = { getHub, listHubs, upsertHub, lessonsForCourse, coursesOverview };
