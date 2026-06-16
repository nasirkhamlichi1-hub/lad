'use strict';

// Data layer for the AI Trainer. Mirrors the prepared-statement style used in
// services/store.js. JSON columns are (de)serialised here so route handlers
// only ever see plain objects/arrays.

const crypto = require('crypto');
const db = require('../db');

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function parse(value, dflt) {
  if (value == null) return dflt;
  try { return JSON.parse(value); } catch { return dflt; }
}

function hydrateLesson(row) {
  if (!row) return null;
  return { ...row, objectives: parse(row.objectives, []), active: !!row.active };
}

// ─── Lessons (the uploaded knowledge base) ───────────────────────────

function listLessons({ includeInactive = false } = {}) {
  const rows = db.prepare(`
    SELECT * FROM trainer_lessons
    ${includeInactive ? '' : 'WHERE active = 1'}
    ORDER BY updated_at DESC
  `).all();
  return rows.map(hydrateLesson);
}

function getLesson(id) {
  return hydrateLesson(db.prepare('SELECT * FROM trainer_lessons WHERE id = ?').get(id));
}

function upsertLesson(lesson, createdById) {
  const id = lesson.id || genId('lsn');
  db.prepare(`
    INSERT INTO trainer_lessons
      (id, title, summary, body, objectives, course_id, language, duration_min, cpd_points, active, created_by_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (id) DO UPDATE SET
      title=excluded.title, summary=excluded.summary, body=excluded.body,
      objectives=excluded.objectives, course_id=excluded.course_id,
      language=excluded.language, duration_min=excluded.duration_min,
      cpd_points=excluded.cpd_points, active=excluded.active,
      updated_at=datetime('now')
  `).run(
    id,
    String(lesson.title || '').trim(),
    lesson.summary || null,
    String(lesson.body || '').trim(),
    JSON.stringify(Array.isArray(lesson.objectives) ? lesson.objectives : []),
    lesson.course_id || null,
    lesson.language || 'English',
    Number.isFinite(lesson.duration_min) ? lesson.duration_min : 15,
    Number.isFinite(lesson.cpd_points) ? lesson.cpd_points : 0,
    lesson.active === false ? 0 : 1,
    createdById || null
  );
  return getLesson(id);
}

function deleteLesson(id) {
  db.prepare('DELETE FROM trainer_lessons WHERE id = ?').run(id);
}

// ─── Sessions (one per live conversation) ────────────────────────────

function createSession({ conversationId, conversationUrl, lessonId, lawyerId, status }) {
  const id = genId('st');
  db.prepare(`
    INSERT INTO trainer_sessions
      (id, conversation_id, conversation_url, lesson_id, lawyer_id, status, events)
    VALUES (?, ?, ?, ?, ?, ?, '[]')
  `).run(id, conversationId || null, conversationUrl || null, lessonId || null, lawyerId || null, status || 'active');
  return getSession(id);
}

function getSession(id) {
  const row = db.prepare('SELECT * FROM trainer_sessions WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, engagement: parse(row.engagement, null), events: parse(row.events, []) };
}

function getSessionByConversationId(conversationId) {
  const row = db.prepare('SELECT * FROM trainer_sessions WHERE conversation_id = ?').get(conversationId);
  return row ? getSession(row.id) : null;
}

function endSession(id, { engagement, transcript } = {}) {
  db.prepare(`
    UPDATE trainer_sessions
    SET status = 'ended', ended_at = datetime('now'),
        engagement = COALESCE(?, engagement),
        transcript = COALESCE(?, transcript)
    WHERE id = ?
  `).run(
    engagement != null ? JSON.stringify(engagement) : null,
    transcript != null ? (typeof transcript === 'string' ? transcript : JSON.stringify(transcript)) : null,
    id
  );
  return getSession(id);
}

// Append a perception/transcript event delivered by the Tavus callback.
function appendEvent(conversationId, event) {
  const session = getSessionByConversationId(conversationId);
  if (!session) return null;
  const events = session.events || [];
  events.push({ at: new Date().toISOString(), ...event });
  db.prepare('UPDATE trainer_sessions SET events = ? WHERE id = ?')
    .run(JSON.stringify(events.slice(-500)), session.id);
  return session.id;
}

function listSessionsForLawyer(lawyerId) {
  return db.prepare(`
    SELECT s.*, l.title AS lesson_title
    FROM trainer_sessions s
    LEFT JOIN trainer_lessons l ON l.id = s.lesson_id
    WHERE s.lawyer_id = ?
    ORDER BY s.started_at DESC
  `).all(lawyerId).map(r => ({ ...r, engagement: parse(r.engagement, null) }));
}

module.exports = {
  listLessons, getLesson, upsertLesson, deleteLesson,
  createSession, getSession, getSessionByConversationId, endSession,
  appendEvent, listSessionsForLawyer,
};
