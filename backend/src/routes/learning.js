'use strict';

// ─────────────────────────────────────────────────────────────────────
// /api/v1/learning — the learning spine
// ─────────────────────────────────────────────────────────────────────
// Course structure for admins, the course outline and attempt lifecycle
// for learners, and progress reporting for both. Every handler is async
// because the store is: see src/lms/engine.js for why.
//
// Deliberately NOT here: any endpoint that writes a percentage or a
// completion status directly. Those are derived from attempts, and an API
// that let an admin set them would make every number in the system
// unfalsifiable.

const express = require('express');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const store = require('../lms/store');
const topics = require('../lms/topics');
const aimodel = require('../services/aimodel');
const log = require('../logger');

const router = express.Router();

const ADMIN_ROLES = ['lad_admin', 'lad_super_admin', 'super_admin', 'dg', 'provider_admin'];
const REPORT_ROLES = [...ADMIN_ROLES, 'firm_compliance_officer'];

const userId = (req) => (req.user && (req.user.sub || req.user.id)) || null;
const isAdmin = (req) => !!req.user && ADMIN_ROLES.includes(req.user.role);

// A lawyer may only ever read their own record. Admins read anyone's;
// a firm compliance officer is checked against their own firm below.
function targetLawyerId(req) {
  const requested = req.params.lawyerId || req.query.lawyer_id;
  if (!requested || requested === 'me') return userId(req);
  return requested;
}

// ─── Topics (admin authoring) ────────────────────────────────────────
// A topic is the journey a lawyer takes: however many SCORM packages,
// documents and AI-taught sessions the author wants, in order. Creating
// one lays out the slots; content is attached afterwards, and nothing
// reaches a learner until each slot is ready and the topic is published.

router.get('/topics', requireRole(...ADMIN_ROLES), async (_req, res, next) => {
  try {
    res.json({ topics: await topics.listTopics() });
  } catch (e) { next(e); }
});

router.post('/topics', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    res.status(201).json(await topics.createTopic(req.body || {}, userId(req)));
  } catch (e) { next(e); }
});

router.get('/topics/:topicId', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    res.json(await topics.getTopic(req.params.topicId));
  } catch (e) { next(e); }
});

router.post('/topics/:topicId/add', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    res.json(await topics.addToTopic(req.params.topicId, req.body || {}, userId(req)));
  } catch (e) { next(e); }
});

// Editing the sequence. A journey is an ordered list, so these work on
// positions: insert before an index, move to an index, remove and close
// the gap. Ten SCORM packages is one call with count: 10.
router.post('/topics/:topicId/steps', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    res.status(201).json(await topics.insertSteps(req.params.topicId, req.body || {}, userId(req)));
  } catch (e) { next(e); }
});

router.post('/topics/:topicId/steps/:activityId/move', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    res.json(await topics.moveStep(req.params.topicId, req.params.activityId, (req.body || {}).to));
  } catch (e) { next(e); }
});

router.delete('/topics/:topicId/steps/:activityId', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    res.json(await topics.removeStep(req.params.topicId, req.params.activityId));
  } catch (e) { next(e); }
});

// Publishing is gated on readiness, not on the caller's say-so: an empty
// SCORM slot or an untaught bot cannot go live by accident. `force` exists
// for the rare deliberate override and reports what it overrode.
router.post('/topics/:topicId/publish', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const result = await topics.publishTopic(req.params.topicId, { force: (req.body || {}).force === true });
    if (result.blocked.length) return res.status(409).json(result);
    res.json(result);
  } catch (e) { next(e); }
});

// ─── Drafting a lesson from uploaded material ────────────────────────
// The author uploads a document; the browser extracts its text; this turns
// that text into a teaching summary and a set of key elements.
//
// The rule that makes it usable: every objective must be QUOTED from the
// source. The model returns a quote alongside each one, we check the quote
// actually appears in the text, and anything it cannot ground is dropped
// before the author ever sees it. A hallucinated learning objective would be
// taught as fact to a room of practising lawyers and recorded as CPD, so the
// cost of a wrong one is much higher than the cost of missing one.
//
// It never writes anything. The author reviews, edits and saves.

const DRAFT_MAX_CHARS = 60000;

// Loose containment test: the model reformats whitespace and quotes, so
// compare on lowercase alphanumerics only.
const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

router.post('/draft-lesson', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    if (!aimodel.configured()) {
      return res.status(501).json({
        error: 'ai_not_configured',
        message: 'No AI model is configured on this server, so material cannot be drafted automatically. Write the key elements by hand — everything else works.',
      });
    }

    const title = String((req.body && req.body.title) || '').trim();
    const raw = String((req.body && req.body.text) || '');
    const text = raw.slice(0, DRAFT_MAX_CHARS);
    if (text.trim().length < 200) {
      return res.status(400).json({ error: 'too_short', message: 'There is not enough text in that document to draft from — at least a couple of paragraphs are needed.' });
    }

    const system = [
      'You prepare training material for the Dubai Legal Affairs Department.',
      'You are given the text of a document. Produce the key elements a lawyer must',
      'be able to demonstrate after being taught from it.',
      '',
      'Rules:',
      '- Draw ONLY on the supplied text. Never add law, obligations or examples that',
      '  are not in it, however well known they are to you.',
      '- Every objective MUST be supported by a verbatim quote copied exactly from the',
      '  text. If you cannot quote it, do not write the objective.',
      '- Write objectives as things the lawyer can DO ("State when the reporting duty',
      '  arises"), not topics ("Reporting duties").',
      '- Between 3 and 8 objectives. Fewer good ones beats more thin ones.',
      '',
      'Reply with JSON only, no prose, in exactly this shape:',
      '{"summary":"one or two sentences","objectives":[{"text":"...","quote":"verbatim from the document"}]}',
    ].join('\n');

    const answer = await aimodel.chat({
      system,
      messages: [{ role: 'user', content: (title ? `Document title: ${title}\n\n` : '') + text }],
      maxTokens: 1500,
      temperature: 0,
    });

    let parsed;
    try {
      const m = String(answer || '').match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : answer);
    } catch (e) {
      log.error('draft_lesson_unparseable', { error: e.message });
      return res.status(502).json({ error: 'bad_draft', message: 'The model did not return usable JSON. Try again, or write the key elements by hand.' });
    }

    const haystack = normalise(text);
    const all = Array.isArray(parsed.objectives) ? parsed.objectives : [];
    const kept = [];
    let dropped = 0;
    for (const o of all) {
      const objective = String((o && o.text) || '').trim();
      const quote = String((o && o.quote) || '').trim();
      if (!objective) continue;
      // A quote of a few words proves nothing; require enough of it to be real.
      const nq = normalise(quote);
      if (nq.length < 25 || !haystack.includes(nq)) { dropped++; continue; }
      kept.push({ text: objective, quote });
    }

    log.info('draft_lesson', { chars: text.length, proposed: all.length, kept: kept.length, dropped });

    res.json({
      summary: String(parsed.summary || '').trim() || null,
      objectives: kept,
      dropped,
      truncated: raw.length > DRAFT_MAX_CHARS,
      note: dropped
        ? `${dropped} suggestion${dropped === 1 ? ' was' : 's were'} dropped because ${dropped === 1 ? 'it could' : 'they could'} not be quoted from the document.`
        : null,
    });
  } catch (e) { next(e); }
});

// ─── Course structure (admin) ────────────────────────────────────────

router.get('/courses/:courseId/structure', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    res.json(await store.getOutline(req.params.courseId, null, { includeUnpublished: true }));
  } catch (e) { next(e); }
});

router.put('/courses/:courseId/modules', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const input = Array.isArray(req.body) ? req.body : [req.body];
    const saved = [];
    for (const m of input) saved.push(await store.upsertModule(req.params.courseId, m));
    res.json({ modules: saved });
  } catch (e) { next(e); }
});

router.delete('/modules/:id', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const ok = await store.deleteModule(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Section not found' });
    res.json({ deleted: true, note: 'Activities in this section were kept and moved to the course root.' });
  } catch (e) { next(e); }
});

router.put('/courses/:courseId/activities', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const input = Array.isArray(req.body) ? req.body : [req.body];
    const saved = [];
    for (const a of input) saved.push(await store.upsertActivity(req.params.courseId, a, userId(req)));
    res.json({ activities: saved });
  } catch (e) { next(e); }
});

router.post('/courses/:courseId/activities/reorder', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const n = await store.reorderActivities(req.params.courseId, ids);
    res.json({ reordered: n });
  } catch (e) { next(e); }
});

// Retire, not delete — attempts are evidence and outlive the syllabus.
router.delete('/activities/:id', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const a = await store.retireActivity(req.params.id);
    if (!a) return res.status(404).json({ error: 'Activity not found' });
    res.json({ activity: a, note: 'Unpublished. Learner attempts against it are retained.' });
  } catch (e) { next(e); }
});

// ─── Course outline (learner) ────────────────────────────────────────

router.get('/courses/:courseId/outline', optionalAuth, async (req, res, next) => {
  try {
    res.json(await store.getOutline(req.params.courseId, userId(req)));
  } catch (e) { next(e); }
});

router.post('/courses/:courseId/enrol', requireAuth, async (req, res, next) => {
  try {
    const enrolment = await store.ensureEnrolment(req.params.courseId, userId(req), 'self');
    res.json({ enrolment });
  } catch (e) { next(e); }
});

router.get('/enrolments/mine', requireAuth, async (req, res, next) => {
  try {
    res.json({ enrolments: await store.listEnrolmentsForLawyer(userId(req)) });
  } catch (e) { next(e); }
});

// ─── Attempts ────────────────────────────────────────────────────────

// Launching an activity. The response carries the attempt id every engine
// reports back against — the AI trainer, and the SCORM runtime once it lands.
router.post('/activities/:id/attempts', requireAuth, async (req, res, next) => {
  try {
    const attempt = await store.startAttempt({
      activityId: req.params.id,
      lawyerId: userId(req),
      externalId: (req.body && req.body.external_id) || null,
      detail: (req.body && req.body.detail) || null,
    });
    if (!attempt) return res.status(404).json({ error: 'Activity not found' });
    const progress = await store.getProgress(req.params.id, userId(req));
    res.status(201).json({ attempt, progress });
  } catch (e) { next(e); }
});

// Settling an attempt. Idempotent: a second close returns the first result
// rather than double-counting, because engines retry on flaky connections.
router.post('/attempts/:id/close', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const attempt = await store.closeAttempt(req.params.id, userId(req), {
      completed: b.completed !== false,
      score: b.score,
      seconds: b.seconds,
      percent: b.percent === undefined ? null : b.percent,
      detail: b.detail || null,
      resumeState: b.resume_state || null,
      abandoned: b.abandoned === true,
    });
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    const progress = await store.getProgress(attempt.activity_id, userId(req));
    const enrolment = await store.getEnrolment(attempt.course_id, userId(req));
    res.json({ attempt, progress, enrolment });
  } catch (e) { next(e); }
});

// ─── Reporting ───────────────────────────────────────────────────────

router.get('/courses/:courseId/cohort', requireRole(...REPORT_ROLES), async (req, res, next) => {
  try {
    const data = await store.cohort(req.params.courseId);
    // A firm officer sees their own firm only. Filtering here rather than in
    // SQL keeps the cohort query one shape for every caller.
    if (!isAdmin(req) && req.user.firm_id) {
      const firmId = req.user.firm_id;
      data.enrolments = data.enrolments.filter((e) => e.firm_id === firmId);
    }
    res.json(data);
  } catch (e) { next(e); }
});

router.get('/learners/:lawyerId/report', requireAuth, async (req, res, next) => {
  try {
    const target = targetLawyerId(req);
    if (!target) return res.status(400).json({ error: 'No learner specified' });
    if (target !== userId(req) && !REPORT_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden — you may only read your own record' });
    }
    res.json(await store.learnerReport(target));
  } catch (e) { next(e); }
});

router.get('/report/mine', requireAuth, async (req, res, next) => {
  try {
    res.json(await store.learnerReport(userId(req)));
  } catch (e) { next(e); }
});

module.exports = router;
