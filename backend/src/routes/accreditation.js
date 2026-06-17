'use strict';

// ─────────────────────────────────────────────────────────────────────
// Course accreditation workflow.
//   GET  /catalogue                      public — approved courses
//   GET  /mine               (auth)      my submitted applications
//   GET  /                   (reviewer)  the review queue (?status=)
//   GET  /:id                (owner/rev) one application
//   POST /                   (auth)      submit an application (A1 + A2)
//   POST /:id/ai-review      (reviewer)  run the AiModel assessment
//   POST /:id/decision       (reviewer)  { decision:'approve'|'reject', reason }
//   GET  /:code/attendees    (owner/rev) attendees recorded against a code
//   POST /:code/attendees    (owner/rev) { attendees:[{email,name}] } -> CPD
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const aimodel = require('../services/aimodel');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const REVIEWER_ROLES = ['lad_admin', 'lad_intelligence', 'lad_super_admin', 'dg'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isReviewer(u) { return !!u && REVIEWER_ROLES.includes(u.role); }
function shortId(prefix) {
  const a = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
  return prefix + a;
}
function genCourseCode() {
  for (let i = 0; i < 20; i++) {
    const code = 'CLPD-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
    const taken = db.prepare('SELECT 1 FROM accreditation_applications WHERE course_code = ?').get(code);
    if (!taken) return code;
  }
  return 'CLPD-' + Date.now().toString(36).toUpperCase();
}
function ownsApp(u, app) {
  if (!u || !app) return false;
  if (isReviewer(u)) return true;
  if (app.submitted_by_id && app.submitted_by_id === u.sub) return true;
  if (app.submitted_by_email && u.email &&
      app.submitted_by_email.toLowerCase() === String(u.email).toLowerCase()) return true;
  if (app.contact_email && u.email &&
      app.contact_email.toLowerCase() === String(u.email).toLowerCase()) return true;
  return false;
}
function publicCourse(a) {
  return {
    courseCode: a.course_code, title: a.title, provider: a.org_name,
    format: a.format, cpdPoints: a.cpd_points, areas: a.areas, summary: a.summary,
    approvedAt: a.reviewed_at,
  };
}

// ─── Public catalogue ────────────────────────────────────────────────
router.get('/catalogue', (_req, res) => {
  const rows = db.prepare(
    "SELECT * FROM accreditation_applications WHERE status = 'approved' ORDER BY reviewed_at DESC"
  ).all();
  res.json({ courses: rows.map(publicCourse) });
});

// ─── My applications ─────────────────────────────────────────────────
router.get('/mine', requireAuth, (req, res) => {
  const u = req.user;
  const email = (u.email || '').toLowerCase();
  const rows = db.prepare(
    `SELECT * FROM accreditation_applications
     WHERE submitted_by_id = ? OR LOWER(submitted_by_email) = ? OR LOWER(contact_email) = ?
     ORDER BY created_at DESC`
  ).all(u.sub || '', email, email);
  res.json({ applications: rows });
});

// ─── Review queue ────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  if (!isReviewer(req.user)) return res.status(403).json({ error: 'Reviewers only' });
  const status = req.query.status;
  const rows = status
    ? db.prepare('SELECT * FROM accreditation_applications WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM accreditation_applications ORDER BY created_at DESC').all();
  res.json({ applications: rows });
});

// ─── Submit an application ───────────────────────────────────────────
router.post('/', requireAuth, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  if (!b.orgName || !b.title) {
    return res.status(400).json({ error: 'Organisation name and course title are required.' });
  }
  const id = shortId('ACC-');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO accreditation_applications
    (id, org_name, org_type, contact_name, contact_email, phone, website, about,
     title, format, duration_hours, cpd_points, areas, summary, outcomes,
     status, submitted_by_id, submitted_by_type, submitted_by_email, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?, 'pending', ?,?,?, ?, ?)`).run(
    id, b.orgName, b.orgType || null, b.contactName || null, (b.contactEmail || '').toLowerCase() || null,
    b.phone || null, b.website || null, b.about || null,
    b.title, b.format || null, b.durationHours != null ? Number(b.durationHours) : null,
    b.cpdPoints != null ? Math.round(Number(b.cpdPoints)) : 0, b.areas || null, b.summary || null, b.outcomes || null,
    u.sub || null, u.user_type || null, (u.email || '').toLowerCase() || null, now, now
  );
  res.status(201).json(db.prepare('SELECT * FROM accreditation_applications WHERE id = ?').get(id));
});

// ─── One application ─────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  const app = db.prepare('SELECT * FROM accreditation_applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });
  if (!ownsApp(req.user, app)) return res.status(403).json({ error: 'Forbidden' });
  res.json(app);
});

// ─── AI assessment (reviewer) ────────────────────────────────────────
router.post('/:id/ai-review', requireAuth, async (req, res, next) => {
  if (!isReviewer(req.user)) return res.status(403).json({ error: 'Reviewers only' });
  const app = db.prepare('SELECT * FROM accreditation_applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });
  if (!aimodel.configured()) {
    return res.status(503).json({ error: 'AiModel is not configured', code: 'AIMODEL_NOT_CONFIGURED' });
  }

  const system = [
    'You are an accreditation assessor for the Dubai Legal Affairs Department CLPD',
    '(Continuing Legal Professional Development) programme. Assess the submitted course',
    'for legal-professional rigour, relevance to practitioners in Dubai, learning value,',
    'and the appropriateness of the requested CPD points (roughly 1 point per hour of',
    'substantive learning, capped sensibly). Reply with ONLY a JSON object, no prose,',
    'of the form: {"recommendedPoints": number, "score": number (0-100),',
    '"verdict": "approve"|"revise"|"reject", "rationale": string, "flags": string[]}.',
  ].join(' ');

  const profile = [
    `Provider: ${app.org_name} (${app.org_type || 'n/a'})`,
    `Course: ${app.title}`,
    `Format: ${app.format || 'n/a'}; Duration (hours): ${app.duration_hours || 'n/a'}`,
    `Points requested: ${app.cpd_points}`,
    `Practice areas: ${app.areas || 'n/a'}`,
    `Summary: ${app.summary || 'n/a'}`,
    `Learning outcomes: ${app.outcomes || 'n/a'}`,
  ].join('\n');

  try {
    const text = await aimodel.chat({
      system,
      messages: [{ role: 'user', content: 'Assess this submission:\n\n' + profile }],
      maxTokens: 600, temperature: 0.2,
    });
    let parsed = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : text);
    } catch (_) { parsed = { rationale: text, verdict: 'revise', flags: ['unparsed_response'] }; }
    const score = JSON.stringify(parsed);
    db.prepare('UPDATE accreditation_applications SET ai_score = ?, updated_at = ? WHERE id = ?')
      .run(score, new Date().toISOString(), app.id);
    res.json({ ok: true, aiScore: parsed });
  } catch (e) {
    if (e.code === 'AIMODEL_ERROR') return res.status(502).json({ error: 'AiModel call failed', detail: e.detail });
    next(e);
  }
});

// ─── Decision (reviewer) ─────────────────────────────────────────────
router.post('/:id/decision', requireAuth, (req, res) => {
  if (!isReviewer(req.user)) return res.status(403).json({ error: 'Reviewers only' });
  const app = db.prepare('SELECT * FROM accreditation_applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const decision = (req.body && req.body.decision) || '';
  const reason = (req.body && req.body.reason) || '';
  const now = new Date().toISOString();

  if (decision === 'approve') {
    const code = app.course_code || genCourseCode();
    db.prepare(`UPDATE accreditation_applications
      SET status = 'approved', course_code = ?, decision_reason = ?,
          reviewed_by_id = ?, reviewed_by_email = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?`).run(code, reason || null, req.user.sub || null,
      (req.user.email || '').toLowerCase() || null, now, now, app.id);
    return res.json({ ok: true, status: 'approved', courseCode: code });
  }
  if (decision === 'reject') {
    if (!reason) return res.status(400).json({ error: 'A reason is required to reject.' });
    db.prepare(`UPDATE accreditation_applications
      SET status = 'rejected', decision_reason = ?, reviewed_by_id = ?,
          reviewed_by_email = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?`).run(reason, req.user.sub || null,
      (req.user.email || '').toLowerCase() || null, now, now, app.id);
    return res.json({ ok: true, status: 'rejected' });
  }
  return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
});

// ─── Attendees / CPD upload ──────────────────────────────────────────
router.get('/:code/attendees', requireAuth, (req, res) => {
  const app = db.prepare('SELECT * FROM accreditation_applications WHERE course_code = ?').get(req.params.code);
  if (!app) return res.status(404).json({ error: 'Course not found' });
  if (!ownsApp(req.user, app)) return res.status(403).json({ error: 'Forbidden' });
  const rows = db.prepare('SELECT * FROM cpd_records WHERE course_code = ? ORDER BY created_at DESC').all(req.params.code);
  res.json({ courseCode: app.course_code, courseTitle: app.title, attendees: rows });
});

router.post('/:code/attendees', requireAuth, (req, res) => {
  const app = db.prepare('SELECT * FROM accreditation_applications WHERE course_code = ?').get(req.params.code);
  if (!app) return res.status(404).json({ error: 'Course not found' });
  if (app.status !== 'approved') return res.status(400).json({ error: 'Course is not approved.' });
  if (!ownsApp(req.user, app)) return res.status(403).json({ error: 'Forbidden' });

  const list = Array.isArray(req.body && req.body.attendees) ? req.body.attendees : [];
  if (!list.length) return res.status(400).json({ error: 'No attendees supplied.' });

  const points = app.cpd_points || 0;
  const insert = db.prepare(`INSERT INTO cpd_records
    (id, attendee_email, attendee_name, lawyer_id, course_code, course_title, provider, points, recorded_by_id, recorded_by_email)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(attendee_email, course_code) DO NOTHING`);

  let recorded = 0, matched = 0, skipped = 0;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const email = String((r && r.email) || '').trim().toLowerCase();
      const name = (r && r.name) ? String(r.name).trim() : null;
      if (!EMAIL_RE.test(email)) { skipped++; continue; }
      const lawyer = store.getLawyerByEmail(email);
      const info = insert.run(shortId('CPD-'), email, name, lawyer ? lawyer.id : null,
        app.course_code, app.title, app.org_name, points,
        req.user.sub || null, (req.user.email || '').toLowerCase() || null);
      if (info.changes > 0) {
        recorded++;
        if (lawyer) { matched++; store.awardCpdPoints({ lawyerId: lawyer.id, points, source: 'accreditation', refId: app.course_code }); }
      }
    }
  });
  tx(list);
  res.json({ ok: true, recorded, matched, skipped, points });
});

module.exports = router;
