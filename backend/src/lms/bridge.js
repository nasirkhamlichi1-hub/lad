'use strict';

// ─────────────────────────────────────────────────────────────────────
// Bridge: the AI trainer reports into the learning spine.
// ─────────────────────────────────────────────────────────────────────
// The trainer keeps its own record (trainer_sessions + trainer_progress)
// and that stays exactly as it was — it holds the transcript, the resume
// recap, the coverage and the engagement summary, none of which belong in
// a generic spine.
//
// What the spine needs is the fact of the sitting: this lawyer worked on
// this activity, for this long, and finished it or didn't. This module
// writes that, and only that, so a lawyer's course percentage counts the
// AI sessions they have actually completed.
//
// It is called from the trainer's own close path, which means every AI
// session lands on the spine no matter which page launched it — the hub,
// the lawyer portal, or a direct link.
//
// Nothing here may throw into the trainer's request. A failure to mirror
// must never lose someone's transcript or block their CPD award, so every
// entry point swallows and logs.

const db = require('./engine');
const store = require('./store');
const log = require('../logger');

// Find the spine activity that represents a trainer lesson. A lesson may
// appear in more than one topic; the enrolled one wins, otherwise the
// first published one.
async function activityForLesson(lessonId, lawyerId) {
  if (!lessonId) return null;

  const enrolled = await db.one(
    `SELECT a.* FROM activity a
     JOIN enrolment e ON e.course_id = a.course_id AND e.lawyer_id = ?
     WHERE a.lesson_id = ? AND a.published = 1
     ORDER BY e.last_active_at DESC
     LIMIT 1`,
    [lawyerId, lessonId]
  );
  if (enrolled) return enrolled;

  return db.one(
    'SELECT * FROM activity WHERE lesson_id = ? AND published = 1 ORDER BY position LIMIT 1',
    [lessonId]
  );
}

// Record a finished (or paused) AI session against the spine.
//
//   mode 'ended'  → the lawyer completed the lesson
//   mode 'paused' → they stopped partway; it stays in progress
//
// Idempotent on sessionId: the trainer can retry a close without the
// attempt being counted twice.
async function recordTrainerSession({ sessionId, lessonId, lawyerId, seconds = 0, mode = 'ended', percent = null, resumeContext = null }) {
  try {
    if (!sessionId || !lawyerId) return null;

    const already = await db.one('SELECT id FROM activity_attempt WHERE external_id = ?', [sessionId]);
    if (already) return already;

    const activity = await activityForLesson(lessonId, lawyerId);
    if (!activity) return null; // lesson isn't part of any topic — nothing to mirror onto

    const attempt = await store.startAttempt({
      activityId: activity.id,
      lawyerId,
      externalId: sessionId,
      detail: { engine: 'ai_trainer', mode },
    });
    if (!attempt) return null;

    await store.closeAttempt(attempt.id, lawyerId, {
      completed: mode === 'ended',
      abandoned: mode !== 'ended',
      seconds: Math.max(0, Math.round(Number(seconds) || 0)),
      percent: percent === null || percent === undefined ? null : percent,
      resumeState: resumeContext || null,
      detail: { engine: 'ai_trainer', mode, trainer_session: sessionId },
    });

    log.info('spine_trainer_mirrored', { sessionId, activityId: activity.id, mode });
    return attempt;
  } catch (e) {
    // Never let a mirroring problem surface in the trainer's response.
    log.error('spine_mirror_failed', { error: e.message, sessionId });
    return null;
  }
}

module.exports = { recordTrainerSession, activityForLesson };
