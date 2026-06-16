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

function hydrateProgress(row) {
  if (!row) return null;
  return { ...row, objectives_done: parse(row.objectives_done, []) };
}

function clampPercent(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
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

function createSession({ conversationId, conversationUrl, lessonId, lawyerId, status, progressId, resumedFromId, engine }) {
  const id = genId('st');
  db.prepare(`
    INSERT INTO trainer_sessions
      (id, conversation_id, conversation_url, lesson_id, lawyer_id, status, events, progress_id, resumed_from_id, engine)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
  `).run(
    id, conversationId || null, conversationUrl || null, lessonId || null, lawyerId || null,
    status || 'active', progressId || null, resumedFromId || null, engine || 'tavus'
  );
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

// Close a session. `status` is 'ended' (finished) or 'paused' (will resume).
function endSession(id, { engagement, transcript, status = 'ended', seconds } = {}) {
  db.prepare(`
    UPDATE trainer_sessions
    SET status = ?, ended_at = datetime('now'),
        engagement = COALESCE(?, engagement),
        transcript = COALESCE(?, transcript),
        seconds = COALESCE(?, seconds)
    WHERE id = ?
  `).run(
    status,
    engagement != null ? JSON.stringify(engagement) : null,
    transcript != null ? (typeof transcript === 'string' ? transcript : JSON.stringify(transcript)) : null,
    seconds != null ? (seconds | 0) : null,
    id
  );
  return getSession(id);
}

// Enrich a session with end-of-call data from the Tavus webhook WITHOUT
// changing its status (a paused session stays paused even though Tavus fires
// its shutdown event when we close the live room).
function recordSessionAnalysis(id, { engagement, transcript } = {}) {
  db.prepare(`
    UPDATE trainer_sessions
    SET engagement = COALESCE(?, engagement),
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

function listSessionsForProgress(progressId) {
  return db.prepare(`
    SELECT * FROM trainer_sessions WHERE progress_id = ? ORDER BY started_at ASC
  `).all(progressId).map(r => ({ ...r, engagement: parse(r.engagement, null), events: parse(r.events, []) }));
}

// ─── Progress (one row per lawyer + lesson) ──────────────────────────
// This is the durable learning record that survives across many sessions and
// powers both multi-user tracking and resume.

function getProgressById(id) {
  return hydrateProgress(db.prepare('SELECT * FROM trainer_progress WHERE id = ?').get(id));
}

function getProgress(lawyerId, lessonId) {
  return hydrateProgress(db.prepare(
    'SELECT * FROM trainer_progress WHERE lawyer_id = ? AND lesson_id = ?'
  ).get(lawyerId, lessonId));
}

function getOrCreateProgress(lawyerId, lessonId) {
  const existing = getProgress(lawyerId, lessonId);
  if (existing) return existing;
  const id = genId('pr');
  db.prepare(`
    INSERT INTO trainer_progress (id, lawyer_id, lesson_id, status)
    VALUES (?, ?, ?, 'in_progress')
  `).run(id, lawyerId, lessonId);
  return getProgressById(id);
}

// Bump counters when a new session/attempt starts against this progress.
function touchProgressOnStart(progressId, sessionId) {
  db.prepare(`
    UPDATE trainer_progress
    SET session_count = session_count + 1,
        last_session_id = ?,
        status = CASE WHEN status = 'completed' THEN status ELSE 'in_progress' END,
        last_active_at = datetime('now')
    WHERE id = ?
  `).run(sessionId, progressId);
  return getProgressById(progressId);
}

// Accrue learning into the durable record. Never lowers an existing percentage.
function updateProgressLearning(progressId, { addSeconds = 0, percent, objectivesDone, engagement, resumeContext } = {}) {
  const p = getProgressById(progressId);
  if (!p) return null;
  const newSeconds = (p.total_seconds || 0) + Math.max(0, addSeconds | 0);
  const newPercent = clampPercent(Math.max(p.percent_complete || 0, percent != null ? percent : 0));
  const bestEng = engagement != null
    ? Math.max(p.best_engagement || 0, Number(engagement) || 0)
    : p.best_engagement;
  db.prepare(`
    UPDATE trainer_progress
    SET total_seconds = ?,
        percent_complete = ?,
        objectives_done = COALESCE(?, objectives_done),
        best_engagement = COALESCE(?, best_engagement),
        resume_context = COALESCE(?, resume_context),
        last_active_at = datetime('now')
    WHERE id = ?
  `).run(
    newSeconds,
    newPercent,
    objectivesDone != null ? JSON.stringify(objectivesDone) : null,
    bestEng != null ? bestEng : null,
    resumeContext != null ? resumeContext : null,
    progressId
  );
  return getProgressById(progressId);
}

function completeProgress(progressId, { cpdPoints = 0 } = {}) {
  const p = getProgressById(progressId);
  if (!p) return null;
  db.prepare(`
    UPDATE trainer_progress
    SET status = 'completed', percent_complete = 100,
        completed_at = datetime('now'), last_active_at = datetime('now'),
        cpd_points_awarded = cpd_points_awarded + ?
    WHERE id = ?
  `).run(cpdPoints | 0, progressId);
  return getProgressById(progressId);
}

// A lawyer's progress across every lesson they've touched (for "My learning").
function listProgressForLawyer(lawyerId) {
  return db.prepare(`
    SELECT p.*, l.title AS lesson_title, l.summary AS lesson_summary,
           l.duration_min, l.cpd_points AS lesson_cpd_points
    FROM trainer_progress p
    LEFT JOIN trainer_lessons l ON l.id = p.lesson_id
    WHERE p.lawyer_id = ?
    ORDER BY p.last_active_at DESC
  `).all(lawyerId).map(hydrateProgress);
}

// Everyone studying a given lesson (admin roster — "who's on this material").
function listProgressForLesson(lessonId) {
  return db.prepare(`
    SELECT p.*,
           TRIM(COALESCE(law.first_name, '') || ' ' || COALESCE(law.last_name, '')) AS lawyer_name,
           law.email AS lawyer_email
    FROM trainer_progress p
    LEFT JOIN lawyers law ON law.id = p.lawyer_id
    WHERE p.lesson_id = ?
    ORDER BY p.last_active_at DESC
  `).all(lessonId).map(hydrateProgress);
}

// Admin overview: per-lesson learner counts and average completion.
function lessonLearnerStats() {
  return db.prepare(`
    SELECT les.id AS lesson_id, les.title, les.active,
           COUNT(p.id) AS learners,
           SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN p.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           COALESCE(ROUND(AVG(p.percent_complete)), 0) AS avg_percent,
           COALESCE(SUM(p.session_count), 0) AS total_sessions
    FROM trainer_lessons les
    LEFT JOIN trainer_progress p ON p.lesson_id = les.id
    GROUP BY les.id
    ORDER BY learners DESC, les.title ASC
  `).all();
}

// ─── Resume context ──────────────────────────────────────────────────
// Turn a paused session into a short recap the trainer reads before the next
// conversation so it continues naturally instead of starting over. Heuristic
// for now (transcript tail + objectives); a clean seam to swap in an LLM
// summary later.

function summariseTranscript(transcript, maxTurns = 8, maxChars = 1500) {
  if (!transcript) return '';
  if (typeof transcript === 'string') return transcript.slice(-maxChars);
  if (Array.isArray(transcript)) {
    return transcript.slice(-maxTurns)
      .map(t => `${t.role || t.speaker || '?'}: ${t.content || t.text || ''}`)
      .join('\n').slice(-maxChars);
  }
  try { return JSON.stringify(transcript).slice(-maxChars); } catch { return ''; }
}

function buildResumeContext(lesson, { transcript, percent, elapsedSeconds } = {}) {
  const parts = [];
  const mins = elapsedSeconds ? `, ~${Math.round(elapsedSeconds / 60)} min spent so far` : '';
  parts.push(`Progress: about ${clampPercent(percent || 0)}% through this lesson${mins}.`);
  if (lesson && Array.isArray(lesson.objectives) && lesson.objectives.length) {
    parts.push(`Lesson objectives: ${lesson.objectives.join('; ')}.`);
  }
  const tail = summariseTranscript(transcript);
  if (tail) parts.push(`Last exchange before pausing:\n${tail}`);
  return parts.join('\n');
}

module.exports = {
  listLessons, getLesson, upsertLesson, deleteLesson,
  createSession, getSession, getSessionByConversationId, endSession,
  recordSessionAnalysis, appendEvent, listSessionsForLawyer, listSessionsForProgress,
  // progress
  getProgress, getProgressById, getOrCreateProgress, touchProgressOnStart,
  updateProgressLearning, completeProgress,
  listProgressForLawyer, listProgressForLesson, lessonLearnerStats,
  buildResumeContext,
};
