'use strict';

// AI Trainer — realistic-avatar 1-2-1 CLPD sessions powered by Tavus CVI.
//
//   GET  /api/v1/trainer/status               public — is the trainer live or demo?
//   GET  /api/v1/trainer/lessons              public — uploaded lessons (active)
//   PUT  /api/v1/trainer/lessons              admin  — upload/replace lessons
//   DELETE /api/v1/trainer/lessons/:id        admin  — remove a lesson
//   POST /api/v1/trainer/sessions             auth   — start OR resume a session
//   POST /api/v1/trainer/sessions/:id/pause   auth   — stop midway, keep progress
//   POST /api/v1/trainer/sessions/:id/end     auth   — finish (completes + awards CPD)
//   GET  /api/v1/trainer/sessions/mine        auth   — my session/attempt history
//   GET  /api/v1/trainer/progress/mine        auth   — my learning across all lessons
//   GET  /api/v1/trainer/progress/:lessonId   auth   — my progress for one lesson (+resume)
//   GET  /api/v1/trainer/lessons/:id/learners admin  — everyone studying a lesson
//   GET  /api/v1/trainer/overview             admin  — per-lesson learner stats
//   POST /api/v1/trainer/callback             public — Tavus webhook (perception/transcript)
//
// All Tavus/ElevenLabs keys live server-side. When Tavus is not configured the
// session endpoint returns { demo: true } so the frontend can run a clearly
// labelled simulated experience instead of failing.

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const tavus = require('../services/tavus');
const trainerStore = require('../services/trainerStore');
const store = require('../services/store');
const config = require('../config');
const log = require('../logger');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');

const ADMIN_ROLES = ['lad_admin', 'lad_super_admin'];

// ─── Status ──────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({
    configured: tavus.isConfigured(),
    demo: !tavus.isConfigured(),
    voice: config.elevenlabs.apiKey && config.elevenlabs.voiceId ? 'elevenlabs' : 'tavus-default',
    perceptionModel: config.tavus.perceptionModel,
    personaConfigured: !!config.tavus.personaId,
    lessonCount: trainerStore.listLessons().length,
  });
});

// ─── Lessons (the knowledge base) ────────────────────────────────────
router.get('/lessons', optionalAuth, (req, res) => {
  const includeInactive = req.user && ADMIN_ROLES.includes(req.user.role) && req.query.all === '1';
  res.json(trainerStore.listLessons({ includeInactive }));
});

router.get('/lessons/:id', optionalAuth, (req, res) => {
  const lesson = trainerStore.getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  res.json(lesson);
});

// Accepts a single lesson object or an array of them.
router.put('/lessons', requireRole(...ADMIN_ROLES), (req, res) => {
  const payload = req.body;
  const items = Array.isArray(payload) ? payload : [payload];
  const saved = [];
  for (const item of items) {
    if (!item || !String(item.title || '').trim() || !String(item.body || '').trim()) {
      return res.status(400).json({ error: 'Each lesson needs a title and body' });
    }
    saved.push(trainerStore.upsertLesson(item, req.user.sub || req.user.id));
  }
  res.json(Array.isArray(payload) ? saved : saved[0]);
});

router.delete('/lessons/:id', requireRole(...ADMIN_ROLES), (req, res) => {
  trainerStore.deleteLesson(req.params.id);
  res.json({ ok: true });
});

// ─── Bundled courses (ready-made course files shipped in /courses) ────
// Lets an admin load a pre-authored course in one click instead of uploading
// a file. Each file in backend/courses/*.json is an array of lesson objects.
const COURSES_DIR = path.join(__dirname, '..', '..', 'courses');

function readCourseFile(file) {
  const safe = path.basename(file);                       // no directory traversal
  if (!safe.endsWith('.json')) return null;
  const full = path.join(COURSES_DIR, safe);
  if (!fs.existsSync(full)) return null;
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  return { file: safe, lessons: Array.isArray(parsed) ? parsed : [parsed] };
}

router.get('/bundled-courses', requireRole(...ADMIN_ROLES), (_req, res) => {
  if (!fs.existsSync(COURSES_DIR)) return res.json([]);
  const out = fs.readdirSync(COURSES_DIR).filter(f => f.endsWith('.json')).map(f => {
    try {
      const { lessons } = readCourseFile(f);
      const titled = lessons.find(l => /welcome/i.test(l.id || '')) || lessons[0] || {};
      return {
        file: f,
        course_id: (lessons[0] || {}).course_id || null,
        title: (titled.title || f).replace(/\s*[—-]\s*Welcome.*$/i, '').trim(),
        lessons: lessons.length,
        totalMin: lessons.reduce((s, l) => s + (l.duration_min || 0), 0),
        totalCpd: lessons.reduce((s, l) => s + (l.cpd_points || 0), 0),
      };
    } catch { return { file: f, error: 'unreadable' }; }
  });
  res.json(out);
});

router.post('/bundled-courses/:file/import', requireRole(...ADMIN_ROLES), (req, res) => {
  let course;
  try { course = readCourseFile(req.params.file); }
  catch (e) { return res.status(400).json({ error: 'Course file is not valid JSON' }); }
  if (!course) return res.status(404).json({ error: 'Bundled course not found' });
  const saved = course.lessons.map(L => trainerStore.upsertLesson(L, req.user.sub || req.user.id));
  log.info('trainer_bundled_imported', { file: course.file, count: saved.length });
  res.json({ imported: saved.length, lessons: saved });
});

// ─── Sessions ────────────────────────────────────────────────────────

const userId = (req) => req.user.sub || req.user.id || null;
const isAdmin = (req) => req.user && ADMIN_ROLES.includes(req.user.role);

// Elapsed seconds for a session, trusting a client-reported value when given,
// else derived from started_at (SQLite UTC) to now.
function sessionSeconds(session, bodySeconds) {
  if (Number.isFinite(bodySeconds) && bodySeconds >= 0) return bodySeconds | 0;
  if (!session || !session.started_at) return 0;
  const started = Date.parse(session.started_at.replace(' ', 'T') + 'Z');
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

// Start a NEW session for a lesson, or RESUME an in-progress one. Either way a
// single trainer_progress row per (lawyer, lesson) tracks the cumulative
// learning, so many lawyers can study the same material independently.
router.post('/sessions', requireAuth, async (req, res, next) => {
  try {
    const { lessonId } = req.body || {};
    const lesson = lessonId ? trainerStore.getLesson(lessonId) : null;
    if (lessonId && !lesson) return res.status(404).json({ error: 'Lesson not found' });

    const lawyerId = userId(req);
    let lawyer = null;
    try { lawyer = lawyerId ? store.getLawyerById(lawyerId) : null; } catch { /* optional */ }
    if (lawyer && !lawyer.name) {
      lawyer.name = [lawyer.first_name, lawyer.last_name].filter(Boolean).join(' ') || null;
    }

    // Progress is keyed to a lesson; ad-hoc (no-lesson) sessions aren't tracked.
    const progress = lesson ? trainerStore.getOrCreateProgress(lawyerId, lesson.id) : null;
    const resuming = !!(progress && progress.status === 'in_progress' && progress.resume_context);
    const resume = resuming
      ? { context: progress.resume_context, percent: progress.percent_complete }
      : null;

    // Demo mode — no Tavus configured. Still tracks progress so the simulated
    // experience behaves like the real one.
    if (!tavus.isConfigured()) {
      const session = trainerStore.createSession({
        lessonId: lesson ? lesson.id : null, lawyerId, status: 'active',
        progressId: progress ? progress.id : null,
        resumedFromId: resuming ? progress.last_session_id : null,
      });
      if (progress) trainerStore.touchProgressOnStart(progress.id, session.id);
      return res.json({
        demo: true, sessionId: session.id, conversationUrl: null, lesson,
        resumed: resuming, progress: progress ? trainerStore.getProgressById(progress.id) : null,
      });
    }

    const conv = await tavus.createConversation({ lesson, lawyer, resume });
    const session = trainerStore.createSession({
      conversationId: conv.conversation_id,
      conversationUrl: conv.conversation_url,
      lessonId: lesson ? lesson.id : null,
      lawyerId,
      status: 'active',
      progressId: progress ? progress.id : null,
      resumedFromId: resuming ? progress.last_session_id : null,
    });
    if (progress) trainerStore.touchProgressOnStart(progress.id, session.id);

    log.info('trainer_session_started', {
      sessionId: session.id, conversationId: conv.conversation_id,
      lessonId: lesson ? lesson.id : null, resumed: resuming,
    });
    res.json({
      demo: false,
      sessionId: session.id,
      conversationId: conv.conversation_id,
      conversationUrl: conv.conversation_url,
      lesson,
      resumed: resuming,
      progress: progress ? trainerStore.getProgressById(progress.id) : null,
    });
  } catch (e) { next(e); }
});

// Shared finaliser for pause + end. `mode` = 'paused' | 'ended'.
async function closeSession(req, res, next, mode) {
  try {
    const session = trainerStore.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.lawyer_id && session.lawyer_id !== userId(req) && !isAdmin(req)) {
      return res.status(403).json({ error: 'Not your session' });
    }

    // Always close the live Tavus room — this frees the concurrency slot.
    if (session.conversation_id) {
      try { await tavus.endConversation(session.conversation_id); }
      catch (e) { log.warn('trainer_close_failed', { error: e.message }); }
    }

    const body = req.body || {};
    const seconds = sessionSeconds(session, body.seconds);
    trainerStore.endSession(session.id, {
      status: mode,
      seconds,
      transcript: body.transcript || null,
    });

    let progress = session.progress_id ? trainerStore.getProgressById(session.progress_id) : null;
    let cpdAwarded = 0;

    if (progress) {
      if (mode === 'paused') {
        const lesson = trainerStore.getLesson(session.lesson_id);
        const resumeContext = trainerStore.buildResumeContext(lesson, {
          transcript: body.transcript,
          percent: body.percent != null ? body.percent : progress.percent_complete,
          elapsedSeconds: (progress.total_seconds || 0) + seconds,
        });
        progress = trainerStore.updateProgressLearning(progress.id, {
          addSeconds: seconds,
          percent: body.percent,
          resumeContext,
        });
      } else { // ended → mark complete and award CPD once
        const lesson = trainerStore.getLesson(session.lesson_id);
        progress = trainerStore.updateProgressLearning(progress.id, { addSeconds: seconds, percent: 100 });
        if (lesson && lesson.cpd_points > 0 && progress.cpd_points_awarded === 0) {
          store.awardCpdPoints({
            lawyerId: session.lawyer_id, points: lesson.cpd_points,
            source: 'ai_trainer', refId: session.id, ip: req.ip,
          });
          cpdAwarded = lesson.cpd_points;
        }
        progress = trainerStore.completeProgress(progress.id, { cpdPoints: cpdAwarded });
      }
    }

    log.info('trainer_session_closed', { sessionId: session.id, mode, seconds, cpdAwarded });
    res.json({ session: trainerStore.getSession(session.id), progress, cpdAwarded, status: mode });
  } catch (e) { next(e); }
}

// Stop midway — the lawyer can come back later and resume this lesson.
router.post('/sessions/:id/pause', requireAuth, (req, res, next) => closeSession(req, res, next, 'paused'));

// Finish — completes the lesson and awards its CPD points (once).
router.post('/sessions/:id/end', requireAuth, (req, res, next) => closeSession(req, res, next, 'ended'));

router.get('/sessions/mine', requireAuth, (req, res) => {
  res.json(trainerStore.listSessionsForLawyer(userId(req)));
});

// ─── Progress (learning records) ─────────────────────────────────────

// My learning across every lesson I've touched.
router.get('/progress/mine', requireAuth, (req, res) => {
  res.json(trainerStore.listProgressForLawyer(userId(req)));
});

// My progress for a single lesson — drives the "Resume" vs "Start" button.
router.get('/progress/:lessonId', requireAuth, (req, res) => {
  const progress = trainerStore.getProgress(userId(req), req.params.lessonId);
  if (!progress) return res.json({ exists: false, resumable: false });
  res.json({
    exists: true,
    resumable: progress.status === 'in_progress',
    resumePreview: progress.resume_context || null,
    progress,
    sessions: trainerStore.listSessionsForProgress(progress.id),
  });
});

// ─── Admin: multi-user tracking ──────────────────────────────────────

// Everyone studying a given lesson, with their progress.
router.get('/lessons/:id/learners', requireRole(...ADMIN_ROLES), (req, res) => {
  const lesson = trainerStore.getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  res.json({ lesson, learners: trainerStore.listProgressForLesson(lesson.id) });
});

// Per-lesson rollup: how many learners, how many completed, average %.
router.get('/overview', requireRole(...ADMIN_ROLES), (_req, res) => {
  res.json({ lessons: trainerStore.lessonLearnerStats() });
});

// ─── Tavus webhook ───────────────────────────────────────────────────
// Tavus posts conversation lifecycle + perception + transcript events here.
// We record them against the session; end-of-call analysis becomes the
// engagement summary. Public endpoint — validate by conversation_id existing.
router.post('/callback', (req, res) => {
  const evt = req.body || {};
  const conversationId = evt.conversation_id || (evt.properties && evt.properties.conversation_id);
  if (!conversationId) return res.status(200).json({ ok: true, ignored: true });

  const type = evt.event_type || evt.message_type || 'event';
  trainerStore.appendEvent(conversationId, { type, data: evt });

  // End-of-call: persist the perception analysis + transcript WITHOUT changing
  // the session's status (a paused session must stay paused even though Tavus
  // fires its shutdown event when we close the room). Also refresh the resume
  // recap for any not-yet-completed lesson so a later resume is richer.
  if (/shutdown|ended|analysis|perception_analysis/i.test(type)) {
    const session = trainerStore.getSessionByConversationId(conversationId);
    if (session) {
      const transcript = evt.transcript || null;
      const engagement = evt.perception_analysis || evt.analysis || evt.shutdown_summary || null;
      trainerStore.recordSessionAnalysis(session.id, { engagement, transcript });

      if (session.progress_id) {
        const progress = trainerStore.getProgressById(session.progress_id);
        if (progress && progress.status !== 'completed' && transcript) {
          const lesson = trainerStore.getLesson(session.lesson_id);
          trainerStore.updateProgressLearning(progress.id, {
            resumeContext: trainerStore.buildResumeContext(lesson, {
              transcript,
              percent: progress.percent_complete,
              elapsedSeconds: progress.total_seconds,
            }),
          });
        }
      }
    }
  }
  res.status(200).json({ ok: true });
});

module.exports = router;
