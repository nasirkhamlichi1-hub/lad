'use strict';

// AI Trainer — realistic-avatar 1-2-1 CLPD sessions powered by Tavus CVI.
//
//   GET  /api/v1/trainer/status            public  — is the trainer live or demo?
//   GET  /api/v1/trainer/lessons           public  — uploaded lessons (active)
//   PUT  /api/v1/trainer/lessons           admin   — upload/replace lessons
//   DELETE /api/v1/trainer/lessons/:id     admin   — remove a lesson
//   POST /api/v1/trainer/sessions          auth    — start a live conversation
//   POST /api/v1/trainer/sessions/:id/end  auth    — end a conversation
//   GET  /api/v1/trainer/sessions/mine      auth    — my past sessions
//   POST /api/v1/trainer/callback          public  — Tavus webhook (perception/transcript)
//
// All Tavus/ElevenLabs keys live server-side. When Tavus is not configured the
// session endpoint returns { demo: true } so the frontend can run a clearly
// labelled simulated experience instead of failing.

const express = require('express');
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

// ─── Sessions ────────────────────────────────────────────────────────
router.post('/sessions', requireAuth, async (req, res, next) => {
  try {
    const { lessonId } = req.body || {};
    const lesson = lessonId ? trainerStore.getLesson(lessonId) : null;
    if (lessonId && !lesson) return res.status(404).json({ error: 'Lesson not found' });

    const lawyerId = req.user.sub || req.user.id || null;
    let lawyer = null;
    try { lawyer = lawyerId ? store.getLawyerById(lawyerId) : null; } catch { /* optional */ }

    // Demo mode — no Tavus configured. Return a placeholder so the frontend
    // can run its simulated experience without a live avatar.
    if (!tavus.isConfigured()) {
      const session = trainerStore.createSession({ lessonId: lesson ? lesson.id : null, lawyerId, status: 'active' });
      return res.json({ demo: true, sessionId: session.id, conversationUrl: null, lesson });
    }

    const conv = await tavus.createConversation({ lesson, lawyer });
    const session = trainerStore.createSession({
      conversationId: conv.conversation_id,
      conversationUrl: conv.conversation_url,
      lessonId: lesson ? lesson.id : null,
      lawyerId,
      status: 'active',
    });

    log.info('trainer_session_started', { sessionId: session.id, conversationId: conv.conversation_id, lessonId: lesson ? lesson.id : null });
    res.json({
      demo: false,
      sessionId: session.id,
      conversationId: conv.conversation_id,
      conversationUrl: conv.conversation_url,
      lesson,
    });
  } catch (e) { next(e); }
});

router.post('/sessions/:id/end', requireAuth, async (req, res, next) => {
  try {
    const session = trainerStore.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.conversation_id) {
      try { await tavus.endConversation(session.conversation_id); } catch (e) { log.warn('trainer_end_failed', { error: e.message }); }
    }
    const ended = trainerStore.endSession(session.id, {});
    res.json(ended);
  } catch (e) { next(e); }
});

router.get('/sessions/mine', requireAuth, (req, res) => {
  const lawyerId = req.user.sub || req.user.id;
  res.json(trainerStore.listSessionsForLawyer(lawyerId));
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

  // Persist the end-of-call perception analysis + transcript when present.
  if (/shutdown|ended|analysis|perception_analysis/i.test(type)) {
    const session = trainerStore.getSessionByConversationId(conversationId);
    if (session) {
      trainerStore.endSession(session.id, {
        engagement: evt.perception_analysis || evt.analysis || evt.shutdown_summary || null,
        transcript: evt.transcript || null,
      });
    }
  }
  res.status(200).json({ ok: true });
});

module.exports = router;
