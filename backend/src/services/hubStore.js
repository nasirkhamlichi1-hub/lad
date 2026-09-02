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

// Both of these end up inside a CSS declaration on the learner's page, so
// neither is taken on trust. An accent has to be a plain hex colour, and a
// hero image has to be an ordinary http(s) or same-origin URL — anything
// else (javascript:, data:, a stray quote or bracket) is dropped, not escaped.
function safeAccent(v) {
  const s = String(v == null ? '' : v).trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '';
}
function safeImage(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > 2000) return '';
  if (/["'()\\<>\s]/.test(s)) return '';
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^\/[^\s]*$/.test(s)) return s;          // same-origin, e.g. /api/v1/.../file
  return '';
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
    hero_image: row.hero_image || '',
    accent: row.accent || '',
    // The bytes never travel in the hub JSON — only whether they exist, so the
    // client knows to point the hero at the image endpoint.
    has_hero_upload: !!row.hero_blob,
    hero_updated_at: row.updated_at || null,
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
      (course_id, title, eyebrow, intro, legislation, faq, cta_label, cta_url, hero_image, accent, published, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT (course_id) DO UPDATE SET
      title=excluded.title, eyebrow=excluded.eyebrow, intro=excluded.intro,
      legislation=excluded.legislation, faq=excluded.faq,
      cta_label=excluded.cta_label, cta_url=excluded.cta_url,
      hero_image=excluded.hero_image, accent=excluded.accent,
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
    safeImage(hub.hero_image),
    safeAccent(hub.accent),
    hub.published ? 1 : 0,
    updatedById || null
  );
  return getHub(courseId);
}

// ─── The hero photo ──────────────────────────────────────────────────
// Held on the hub row rather than in course_materials because it is served
// to anyone who can open the hub page, without a bearer token.
const HERO_MAX_BYTES = 3 * 1024 * 1024;
const HERO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

function setHero(courseId, buffer, mime) {
  const id = String(courseId || '').trim();
  if (!id) throw new Error('course_id is required');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('No image received.');
  if (buffer.length > HERO_MAX_BYTES) throw new Error('That image is over 3 MB — please use a smaller one.');
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (HERO_MIMES.indexOf(m) < 0) throw new Error('That file is not an image the browser can show (JPEG, PNG, WebP, AVIF or GIF).');
  // The hub row may not exist yet for a course that has only lessons.
  db.prepare(`INSERT INTO course_hubs (course_id, updated_at) VALUES (?, datetime('now'))
              ON CONFLICT (course_id) DO NOTHING`).run(id);
  db.prepare("UPDATE course_hubs SET hero_blob = ?, hero_mime = ?, updated_at = datetime('now') WHERE course_id = ?")
    .run(buffer, m, id);
  return getHub(id);
}

function getHero(courseId) {
  const r = db.prepare('SELECT hero_blob, hero_mime, updated_at FROM course_hubs WHERE course_id = ?').get(courseId);
  if (!r || !r.hero_blob) return null;
  return { data: r.hero_blob, mime: r.hero_mime || 'image/jpeg', updated_at: r.updated_at };
}

function clearHero(courseId) {
  db.prepare("UPDATE course_hubs SET hero_blob = NULL, hero_mime = NULL, updated_at = datetime('now') WHERE course_id = ?").run(courseId);
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

module.exports = { getHub, listHubs, upsertHub, setHero, getHero, clearHero, lessonsForCourse, coursesOverview };
