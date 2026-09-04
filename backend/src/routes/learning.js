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
// The lawyer directory, kept separate from the LMS store above. Needed to
// resolve a learner's firm when scoping a report to a compliance officer.
const lawyers = require('../services/store');
const topics = require('../lms/topics');
const aimodel = require('../services/aimodel');
const log = require('../logger');
// Direct read of the SCORM player's saved state when settling a SCORM attempt.
const db = require('../db');

const router = express.Router();

const ADMIN_ROLES = ['lad_admin', 'lad_super_admin', 'super_admin', 'dg', 'provider_admin'];
const REPORT_ROLES = [...ADMIN_ROLES, 'firm_compliance_officer'];
// Who may read a NAMED lawyer's full learning record across firms. Deliberately
// excludes provider_admin: a training provider sees its own cohorts, never an
// individual lawyer's history at another organisation.
const LAD_REPORT_ROLES = ['lad_admin', 'lad_super_admin', 'super_admin', 'dg'];

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

// Delete a WHOLE topic — steps, AI lessons, enrolments, progress, attempts,
// sections and reference materials. For clearing out old and test topics;
// the builder asks for explicit confirmation before calling this.
router.delete('/topics/:topicId', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    res.json(await topics.deleteTopic(req.params.topicId));
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

    let answer;
    try {
      answer = await aimodel.chat({
        system,
        messages: [{ role: 'user', content: (title ? `Document title: ${title}\n\n` : '') + text }],
        maxTokens: 1500,
        temperature: 0,
      });
    } catch (e) {
      // Say WHAT failed instead of a naked 500 — the author sees this message
      // in the drawer and can tell an unreachable endpoint from a refused key.
      log.error('draft_lesson_ai_failed', { code: e.code, error: e.message, detail: e.detail });
      return res.status(502).json({
        error: 'ai_unreachable',
        message: 'The AI service could not be reached: ' + e.message +
          '. An administrator should check the AI settings on the server (a stale endpoint may still be configured). You can write the key elements by hand below — everything else works.',
      });
    }

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

// ─── Assignment ──────────────────────────────────────────────────────
// Publishing makes a topic reachable; it puts it in front of nobody. An
// assignment is the Department (or a firm's compliance officer, for their
// own lawyers) putting a published topic on named lawyers' learning lists.
// It is an enrolment with source 'assigned' and a record of who did it, so
// the learner sees it on their dashboard at once, the cohort view counts
// them from that moment, and nothing about progress is invented — the
// enrolment starts at 0% like any other.

const ASSIGN_ROLES = ['lad_admin', 'lad_super_admin', 'super_admin', 'dg', 'firm_compliance_officer'];
const isLAD = (req) => !!req.user && LAD_REPORT_ROLES.includes(req.user.role);

function rid(prefix) { return prefix + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(); }
function assignmentLog(a) {
  try {
    db.prepare(
      `INSERT INTO activity_log (id, firm_id, lawyer_id, kind, actor_type, actor_id, actor_name, summary, ref_type, ref_id, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(rid('AC'), a.firm_id || null, a.lawyer_id || null, a.kind, a.actor_type || null, a.actor_id || null,
      a.actor_name || null, a.summary || null, 'learning', a.ref_id || null,
      a.meta ? JSON.stringify(a.meta) : null, new Date().toISOString());
  } catch (e) { log.error('activity_log_failed', { error: e.message }); }
}
function notifyLawyer(lawyerId, title, body, by) {
  try {
    db.prepare('INSERT INTO notifications (id, recipient_type, recipient_id, title, body, level, created_by) VALUES (?,?,?,?,?,?,?)')
      .run(rid('NT'), 'lawyer', lawyerId, title, body, 'info', by || 'LAD');
  } catch (e) { log.error('notify_failed', { error: e.message }); }
}

// Topics that can be assigned right now: those with at least one published
// step. A draft topic is not offered — assigning it would put an empty hub
// in front of a lawyer.
router.get('/assignable', requireRole(...ASSIGN_ROLES), async (_req, res, next) => {
  try {
    const all = await topics.listTopics();
    res.json({ topics: all.filter((t) => t.published > 0) });
  } catch (e) { next(e); }
});

router.post('/courses/:courseId/assign', requireRole(...ASSIGN_ROLES), async (req, res, next) => {
  try {
    const courseId = req.params.courseId;
    const b = req.body || {};
    const note = String(b.note || '').trim().slice(0, 500) || null;
    const dueAt = b.due_at && /^\d{4}-\d{2}-\d{2}/.test(String(b.due_at)) ? String(b.due_at).slice(0, 10) : null;

    // The topic must exist and be published — at least one step a learner can open.
    const published = await store.listActivities(courseId);
    if (!published.length) {
      const any = await store.listActivities(courseId, { includeUnpublished: true });
      return res.status(any.length ? 409 : 404).json(any.length
        ? { error: 'not_published', message: 'This topic has no published steps yet. Publish it in the Topic Builder, then assign it.' }
        : { error: 'not_found', message: 'No such topic.' });
    }
    const mods = await store.listModules(courseId);
    const topicTitle = mods.length ? mods[0].title : courseId;

    // Who: explicit lawyer ids, a whole firm, or both. A firm officer is
    // confined to their own firm whatever the request says.
    const officerFirm = isLAD(req) ? null : (req.user.firm_id || null);
    if (!isLAD(req) && !officerFirm) return res.status(403).json({ error: 'Forbidden — no firm context for this account' });

    const wanted = new Map();
    const ids = Array.isArray(b.lawyer_ids) ? b.lawyer_ids.map(String) : [];
    for (const id of ids) wanted.set(id, null);
    const firmId = officerFirm || (b.firm_id ? String(b.firm_id) : null);
    if (b.firm_id || (officerFirm && b.whole_firm)) {
      for (const l of lawyers.getLawyersByFirm(firmId)) {
        const st = String(l.status || 'active').toLowerCase();
        if (['inactive', 'resigned', 'non-practising'].includes(st)) continue;
        wanted.set(l.id, l);
      }
    }
    if (!wanted.size) return res.status(400).json({ error: 'nobody', message: 'Choose at least one lawyer, or a firm.' });

    const actor = { id: userId(req), name: req.user.name || (isLAD(req) ? 'The Department' : 'Your firm') };
    const out = { topic_id: courseId, title: topicTitle, assigned: [], already: [], skipped: [] };

    for (const [id, pre] of wanted) {
      // getLawyersByFirm does not return firm_id; those rows came from the firm, so say so.
      const l = pre ? Object.assign({ firm_id: firmId }, pre) : lawyers.getLawyerById(id);
      if (!l) { out.skipped.push({ id, reason: 'not_found' }); continue; }
      if (officerFirm && l.firm_id !== officerFirm) { out.skipped.push({ id, reason: 'not_your_firm' }); continue; }

      const existing = await store.getEnrolment(courseId, id);
      if (existing) { out.already.push({ id, name: `${l.first_name || ''} ${l.last_name || ''}`.trim(), percent: existing.percent, status: existing.status }); continue; }

      await store.ensureEnrolment(courseId, id, 'assigned');
      const ts = new Date().toISOString();
      try {
        await require('../lms/engine').run(
          'UPDATE enrolment SET assigned_by = ?, assigned_by_name = ?, assigned_at = ?, due_at = ?, note = ? WHERE course_id = ? AND lawyer_id = ?',
          [actor.id, actor.name, ts, dueAt, note, courseId, id]
        );
      } catch (e) { log.warn('assignment_detail_failed', { error: e.message }); }

      const name = `${l.first_name || ''} ${l.last_name || ''}`.trim() || id;
      notifyLawyer(id,
        `New training assigned: ${topicTitle}`,
        `${actor.name} has assigned you the topic "${topicTitle}".` + (dueAt ? ` Please complete it by ${dueAt}.` : '') + (note ? ` Note: ${note}` : '') + ' Open it from My Learning on your dashboard.',
        actor.name);
      assignmentLog({
        firm_id: l.firm_id || null, lawyer_id: id, kind: 'course_assigned',
        actor_type: isLAD(req) ? 'admin' : 'firm', actor_id: actor.id, actor_name: actor.name,
        summary: `${actor.name} assigned "${topicTitle}" to ${name}` + (dueAt ? ` (due ${dueAt})` : ''),
        ref_id: courseId, meta: { topic_id: courseId, due_at: dueAt, note },
      });
      out.assigned.push({ id, name });
    }
    res.status(out.assigned.length ? 201 : 200).json(out);
  } catch (e) { next(e); }
});

// Take a topic off a lawyer's list. Only an enrolment that has not been
// started is withdrawn outright; one with attempts is evidence and is
// marked withdrawn instead, so the record of what they did survives.
router.delete('/courses/:courseId/assign/:lawyerId', requireRole(...ASSIGN_ROLES), async (req, res, next) => {
  try {
    const { courseId, lawyerId } = req.params;
    const l = lawyers.getLawyerById(lawyerId);
    if (!l) return res.status(404).json({ error: 'No such lawyer' });
    if (!isLAD(req) && l.firm_id !== req.user.firm_id) return res.status(403).json({ error: 'Forbidden — not a lawyer at your firm' });
    const e = await store.getEnrolment(courseId, lawyerId);
    if (!e) return res.status(404).json({ error: 'Not enrolled' });
    const engine = require('../lms/engine');
    const started = await engine.one('SELECT 1 AS x FROM activity_attempt at JOIN activity a ON a.id = at.activity_id WHERE a.course_id = ? AND at.lawyer_id = ? LIMIT 1', [courseId, lawyerId]);
    if (started) await engine.run("UPDATE enrolment SET status = 'withdrawn' WHERE course_id = ? AND lawyer_id = ?", [courseId, lawyerId]);
    else await engine.run('DELETE FROM enrolment WHERE course_id = ? AND lawyer_id = ?', [courseId, lawyerId]);
    const mods = await store.listModules(courseId);
    const title = mods.length ? mods[0].title : courseId;
    const actorName = req.user.name || (isLAD(req) ? 'The Department' : 'Your firm');
    assignmentLog({ firm_id: l.firm_id || null, lawyer_id: lawyerId, kind: 'course_unassigned', actor_type: isLAD(req) ? 'admin' : 'firm', actor_id: userId(req), actor_name: actorName, summary: `${actorName} removed "${title}" from ${`${l.first_name || ''} ${l.last_name || ''}`.trim() || lawyerId}`, ref_id: courseId });
    res.json({ ok: true, outcome: started ? 'withdrawn' : 'removed' });
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
    let completed = b.completed !== false;
    let score = b.score;
    let abandoned = b.abandoned === true;
    let percent = b.percent === undefined ? null : b.percent;
    let detail = b.detail || null;

    // For a SCORM step the server already holds the truth: the player commits
    // the learner's cmi to scorm_state on every LMSCommit. So a close that
    // arrives as "abandoned" — the reader's Close button, a tab shut before
    // the package called Terminate, a finish message that never reached the
    // page — is settled from that state, not from what the client managed to
    // relay. Without this a learner could reach the last screen, close the
    // overlay, and be told they were still in progress.
    try {
      const open = await store.getAttempt(req.params.id);
      if (open && open.lawyer_id === userId(req) && open.status === 'open' && open.kind === 'scorm') {
        const act = await store.getActivity(open.activity_id);
        const st = act && act.material_id
          ? db.prepare('SELECT cmi FROM scorm_state WHERE material_id = ? AND lawyer_id = ?').get(act.material_id, userId(req))
          : null;
        if (st && st.cmi) {
          const cmi = JSON.parse(st.cmi) || {};
          const g = (k) => (cmi[k] == null ? '' : String(cmi[k]));
          const ls = g('cmi.core.lesson_status'), cs = g('cmi.completion_status'), ss = g('cmi.success_status');
          const done = ls === 'completed' || ls === 'passed' || ls === 'failed' || cs === 'completed' || ss === 'passed' || ss === 'failed';
          const rawS = g('cmi.core.score.raw') || g('cmi.score.raw');
          const scaled = g('cmi.score.scaled');
          // The package's own verdict is the verdict. A close that claims
          // completion the package has not recorded is not completion.
          completed = done; if (done) abandoned = false;
          if (done) {
            if ((score === null || score === undefined) && rawS !== '' && Number.isFinite(Number(rawS))) score = Number(rawS);
            if ((score === null || score === undefined) && scaled !== '' && Number.isFinite(Number(scaled))) score = Math.round(Number(scaled) * 100);
            if (percent == null && score != null) percent = score;
            detail = Object.assign({}, detail || {}, { settled_from: 'scorm_state' });
          } else if (!completed) {
            // Not done by the package's own rules: pass on what it knows so the
            // hub can say how far along the learner is rather than nothing.
            const pm = g('cmi.progress_measure');
            if (percent == null && pm !== '' && Number.isFinite(Number(pm))) percent = Math.round(Number(pm) * 100);
            detail = Object.assign({}, detail || {}, { package_status: cs || ls || 'unknown' });
          }
        }
      }
    } catch (e) { log.warn('scorm_state_settle_failed', { attempt: req.params.id, error: e.message }); }

    const attempt = await store.closeAttempt(req.params.id, userId(req), {
      completed,
      score,
      seconds: b.seconds,
      percent,
      detail,
      resumeState: b.resume_state || null,
      abandoned,
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

// A learner report is the whole record of one named lawyer — every enrolment,
// every attempt, every score. Role membership alone is not enough to read it:
// a firm compliance officer is confined to their own firm, and a training
// provider has no business reading a lawyer's record at all. Without the firm
// check, an officer at one firm could enumerate lawyer ids and pull the full
// learning history of a competitor's lawyers.
router.get('/learners/:lawyerId/report', requireAuth, async (req, res, next) => {
  try {
    const target = targetLawyerId(req);
    if (!target) return res.status(400).json({ error: 'No learner specified' });

    if (target !== userId(req)) {
      const role = req.user.role;
      if (LAD_REPORT_ROLES.includes(role)) {
        // LAD reads the whole profession — that is the Department's remit.
      } else if (role === 'firm_compliance_officer') {
        if (!req.user.firm_id) {
          return res.status(403).json({ error: 'Forbidden — no firm context for this account' });
        }
        const learner = lawyers.getLawyerById(target);
        if (!learner || learner.firm_id !== req.user.firm_id) {
          return res.status(403).json({ error: 'Forbidden — you may only read learners at your own firm' });
        }
      } else {
        return res.status(403).json({ error: 'Forbidden — you may only read your own record' });
      }
    }
    res.json(await store.learnerReport(target));
  } catch (e) { next(e); }
});

// What a SCORM package has recorded for one learner — the package's own
// status and score — so support can answer "I finished it but it says in
// progress" from the evidence rather than from the learner's memory.
router.get('/learners/:lawyerId/scorm/:materialId', requireRole(...LAD_REPORT_ROLES), async (req, res, next) => {
  try {
    const st = db.prepare('SELECT cmi, updated_at FROM scorm_state WHERE material_id = ? AND lawyer_id = ?').get(req.params.materialId, req.params.lawyerId);
    if (!st) return res.json({ saved: false, message: 'The package has not saved any state for this learner — it was never opened, or it never called Commit/Finish.' });
    let cmi = {}; try { cmi = JSON.parse(st.cmi) || {}; } catch (_) {}
    const g = (k) => (cmi[k] == null ? null : String(cmi[k]));
    res.json({
      saved: true, updated_at: st.updated_at,
      lesson_status: g('cmi.core.lesson_status'), completion_status: g('cmi.completion_status'), success_status: g('cmi.success_status'),
      score_raw: g('cmi.core.score.raw') || g('cmi.score.raw'), score_scaled: g('cmi.score.scaled'),
      lesson_location: g('cmi.core.lesson_location') || g('cmi.location'), progress_measure: g('cmi.progress_measure'),
      keys: Object.keys(cmi).length,
    });
  } catch (e) { next(e); }
});

router.get('/report/mine', requireAuth, async (req, res, next) => {
  try {
    res.json(await store.learnerReport(userId(req)));
  } catch (e) { next(e); }
});

module.exports = router;
