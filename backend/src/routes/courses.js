'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const feedback = require('../services/feedback');
const tagger = require('../services/coursetagger');
const email = require('../services/email');
const tpl = require('../services/email-templates');
const activity = require('../services/activity');
const blob = require('../services/blobStorage');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');

const _nid = () => 'NT-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 10);
const _tid = () => 'TX-' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
// Notify every lawyer with an active booking on a session.
function notifyBookedLawyers(sessionId, title, body, level, by) {
  try {
    const bks = db.prepare("SELECT lawyer_id FROM bookings WHERE session_id = ? AND status NOT IN ('cancelled','refunded')").all(sessionId);
    const ins = db.prepare('INSERT INTO notifications (id, recipient_type, recipient_id, title, body, level, created_by) VALUES (?,?,?,?,?,?,?)');
    for (const b of bks) if (b.lawyer_id) ins.run(_nid(), 'lawyer', b.lawyer_id, title, body, level || 'warning', by || 'LAD Admin');
    return bks.length;
  } catch (_) { return 0; }
}

// Current smart tags for a course (joined to taxonomy labels).
function courseTopics(courseId) {
  try {
    return db.prepare(
      `SELECT ct.topic_id, ct.weight, ct.source, t.label, t.domain
       FROM course_topics ct JOIN taxonomies t ON t.id = ct.topic_id
       WHERE ct.course_id = ? ORDER BY ct.weight DESC`
    ).all(courseId);
  } catch (_) { return []; }
}

// GET /api/v1/courses — public (used by the public CLPD portal)
router.get('/', optionalAuth, (req, res) => res.json(store.getCourses(req.user)));

// GET /api/v1/courses/upcoming — "Upcoming activities" feed: active courses
// with their next session, live seat counts and smart tags. (Before /:id.)
// Private accredited courses are only included for their owning firm / LAD.
router.get('/upcoming', optionalAuth, (req, res) => {
  const now = new Date().toISOString();
  let courses = [];
  try {
    const vis = store.courseVisibility(req.user);
    courses = db.prepare(
      `SELECT c.*, p.name AS provider_name FROM courses c LEFT JOIN providers p ON p.id = c.provider_id WHERE c.active = 1${vis.sql}`
    ).all(...vis.params);
  } catch (_) {}
  const out = courses.map((c) => {
    let sessions = [];
    try {
      sessions = db.prepare(
        "SELECT id, scheduled_at, end_at, seats_remaining, capacity, venue, language, status FROM course_sessions WHERE course_id = ? AND scheduled_at >= ? AND status != 'cancelled' ORDER BY scheduled_at ASC"
      ).all(c.id, now);
    } catch (_) {}
    let rating = null, provider_rating = null;
    try { rating = feedback.courseRating(c.id); } catch (_) {}
    try { if (c.provider_id) provider_rating = feedback.providerRating(c.provider_id); } catch (_) {}
    return {
      id: c.id, title: c.title, type: c.type, format: c.format,
      pts: c.pts, credits: c.credits, provider_id: c.provider_id,
      provider_name: c.provider_name || null,
      description: c.description || null, language: c.language || null,
      category: c.category || null,
      location: c.location, bg: c.bg, icon: c.icon,
      elearning: /e-?learning/i.test(c.format || ''),
      next_session: sessions.length ? sessions[0].scheduled_at : null,
      sessions, tags: courseTopics(c.id),
      rating, provider_rating,
    };
  });
  out.sort((a, b) => (a.next_session || '9999').localeCompare(b.next_session || '9999'));
  res.json(out);
});

// POST /api/v1/courses/sessions/:id/register-free — LAD service staff book onto
// any CLPD session free of charge (no credits). Decrements the live seat count.
router.post('/sessions/:id/register-free', requireRole('lad_staff'), (req, res) => {
  const id = req.params.id;
  const s = db.prepare('SELECT id, seats_remaining, status, course_id FROM course_sessions WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if ((s.status || '') === 'cancelled') return res.status(409).json({ error: 'session_cancelled', message: 'This session has been cancelled.' });
  if ((Number(s.seats_remaining) || 0) <= 0) return res.status(409).json({ error: 'sold_out', message: 'This session is full.' });
  const upd = db.prepare(
    "UPDATE course_sessions SET seats_remaining = seats_remaining - 1, " +
    "status = CASE WHEN seats_remaining - 1 <= 0 THEN 'closed' ELSE status END " +
    "WHERE id = ? AND seats_remaining > 0"
  ).run(id);
  if (upd.changes !== 1) return res.status(409).json({ error: 'sold_out', message: 'This session just filled up.' });
  const seats = db.prepare('SELECT seats_remaining FROM course_sessions WHERE id = ?').get(id).seats_remaining;
  res.json({ ok: true, free: true, seats_remaining: Number(seats) || 0 });
});

// POST /api/v1/courses/sessions/:id/cancel — cancel a session: refund + free all
// bookings, then notify every affected lawyer in-system AND by email, and write
// the refund to the audit trail.
router.post('/sessions/:id/cancel', requireRole('lad_admin', 'lad_super_admin', 'super_admin', 'dg'), (req, res) => {
  const id = req.params.id;
  const s = db.prepare('SELECT * FROM course_sessions WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const course = store.getCourseById(s.course_id);
  const cTitle = (course && course.title) || 'a course';
  const PRICE = Number(process.env.CREDIT_PRICE_AED || 210);
  // Capture who is booked BEFORE we cancel — otherwise the post-cancel notify
  // query (status NOT IN cancelled) would find nobody.
  const bks = db.prepare("SELECT * FROM bookings WHERE session_id = ? AND status NOT IN ('cancelled','refunded')").all(id);
  const affected = [];
  const tx = db.transaction(() => {
    for (const bk of bks) {
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(bk.id);
      const cost = Number(bk.credits_used) || 0;
      let toFirm = false, firmId = null;
      if (bk.lawyer_id) {
        const lw = db.prepare('SELECT firm_id FROM lawyers WHERE id = ?').get(bk.lawyer_id) || {};
        firmId = lw.firm_id || null;
        if (cost > 0) {
          // Firm-funded bookings return to the firm pool; self-funded to the lawyer.
          if (lw.firm_id && bk.booked_by !== 'self') {
            toFirm = true;
            db.prepare('UPDATE firms SET credit_pool = COALESCE(credit_pool,0) + ? WHERE id = ?').run(cost, lw.firm_id);
            try {
              db.prepare("INSERT INTO firm_credit_transactions (id, firm_id, type, amount, aed_amount, description, lawyer_id) VALUES (?,?,?,?,?,?,?)")
                .run('FTX-' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8), lw.firm_id, 'refund', cost, cost * PRICE, 'Session cancelled — credits returned to firm pool', bk.lawyer_id);
            } catch (_) {}
          } else {
            db.prepare('UPDATE lawyers SET credit_balance = COALESCE(credit_balance,0) + ? WHERE id = ?').run(cost, bk.lawyer_id);
            try {
              db.prepare("INSERT INTO credit_transactions (id, lawyer_id, type, amount, aed_amount, description, payment_method, status) VALUES (?,?,?,?,?,?,?, 'completed')")
                .run(_tid(), bk.lawyer_id, 'refund', cost, cost * PRICE, 'Session cancelled — credits refunded', 'admin');
            } catch (_) {}
          }
        }
        affected.push({ booking_id: bk.id, lawyer_id: bk.lawyer_id, cost, toFirm, firmId });
      }
    }
    db.prepare("UPDATE course_sessions SET status = 'cancelled' WHERE id = ?").run(id);
  });
  tx();

  // Notify every affected lawyer: in the system, by email, and on the audit trail.
  const ins = db.prepare('INSERT INTO notifications (id, recipient_type, recipient_id, title, body, level, created_by) VALUES (?,?,?,?,?,?,?)');
  const actor = req.user.email || req.user.name || 'LAD Admin';
  let emailed = 0;
  for (const af of affected) {
    const lw = db.prepare('SELECT first_name, last_name, email, credit_balance FROM lawyers WHERE id = ?').get(af.lawyer_id) || {};
    const name = tpl.fullName(lw.first_name, lw.last_name);
    const refundMsg = af.cost > 0 ? (af.toFirm ? ` ${af.cost} credit${af.cost === 1 ? '' : 's'} returned to your firm's pool.` : ` ${af.cost} credit${af.cost === 1 ? '' : 's'} refunded to your balance.`) : '';
    try { ins.run(_nid(), 'lawyer', af.lawyer_id, 'Session cancelled · ' + cTitle, 'Your booked session for "' + cTitle + '" has been cancelled.' + refundMsg + ' Please book an alternative session.', 'urgent', actor); } catch (_) {}
    if (lw.email) {
      try {
        email.send('cancellation', tpl.bookingCancellation({
          name, courseTitle: cTitle, refundCredits: af.cost || null,
          balance: lw.credit_balance != null ? Number(lw.credit_balance) : null,
        }), { to: lw.email, toName: name, ref: af.booking_id, dedupeKey: 'session_cancel:' + af.booking_id });
        emailed++;
      } catch (_) {}
    }
    try {
      activity.logActivity(Object.assign({
        lawyer_id: af.lawyer_id, firm_id: af.firmId, kind: 'booking_cancel', category: 'bookings',
        tags: ['session-cancelled', af.cost > 0 ? 'refund' : 'no-charge', af.toFirm ? 'refund-firm' : 'refund-lawyer'],
        aed: af.cost * PRICE,
        summary: `Session cancelled — "${cTitle}"` + (af.cost > 0 ? ` · ${af.cost} credit${af.cost === 1 ? '' : 's'} ${af.toFirm ? 'returned to firm pool' : 'refunded to lawyer'}` : ''),
        ref_type: 'session', ref_id: id,
        meta: { booking_id: af.booking_id, credits: af.cost, refund_to: af.toFirm ? 'firm' : 'lawyer' },
      }, activity.actorFrom(req.user)));
    } catch (_) {}
  }
  res.json({ ok: true, cancelled: bks.length, refunded: affected.filter((a) => a.cost > 0).length, notified: affected.length, emailed });
});

// POST /api/v1/courses/sessions/:id/reschedule — move a session; booked lawyers
// keep their seat and are notified.
router.post('/sessions/:id/reschedule', requireRole('lad_admin', 'lad_super_admin', 'super_admin', 'dg'), (req, res) => {
  const id = req.params.id; const b = req.body || {};
  const s = db.prepare('SELECT * FROM course_sessions WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const sets = [], args = [];
  if (b.scheduled_at) { sets.push('scheduled_at = ?'); args.push(b.scheduled_at); }
  if (b.end_at !== undefined) { sets.push('end_at = ?'); args.push(b.end_at || null); }
  if (b.venue !== undefined) { sets.push('venue = ?'); args.push(b.venue || null); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  args.push(id);
  db.prepare(`UPDATE course_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  const course = store.getCourseById(s.course_id); const cTitle = (course && course.title) || 'a course';
  const notified = notifyBookedLawyers(id, 'Session moved · ' + cTitle,
    'Your booked session for "' + cTitle + '" has been rescheduled'
    + (b.scheduled_at ? (' to ' + new Date(b.scheduled_at).toDateString()) : '')
    + (b.venue ? (' at ' + b.venue) : '') + '. Your booking has moved with it — no action needed.',
    'warning', req.user.email || 'LAD Admin');
  res.json({ ok: true, notified });
});

// POST /api/v1/courses/:id/sessions — add a session to a course.
router.post('/:id/sessions', requireRole('lad_admin', 'provider_admin'), (req, res) => {
  const courseId = req.params.id; const b = req.body || {};
  const course = store.getCourseById(courseId);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (!b.scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
  const sid = 'S-' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
  const cap = Math.max(1, Number(b.capacity) || 30);
  db.prepare("INSERT INTO course_sessions (id, course_id, scheduled_at, end_at, capacity, seats_remaining, venue, language, status) VALUES (?,?,?,?,?,?,?,?, 'scheduled')")
    .run(sid, courseId, b.scheduled_at, b.end_at || null, cap, cap, b.venue || course.location || 'Dubai', b.language || 'English');
  res.status(201).json({ ok: true, id: sid, seats_remaining: cap });
});

// GET /api/v1/courses/:id/feedback — star ratings (out of 5) for the booking
// view: the 4 course metrics + the 3 provider/trainer metrics, with per-year
// breakdown. Public (shown before a lawyer commits to booking).
router.get('/:id/feedback', optionalAuth, (req, res) => {
  const rating = feedback.courseRating(req.params.id);
  res.json({ course_id: req.params.id, rating: rating || null, provider: rating ? rating.provider : null });
});

// POST /api/v1/courses/:id/feedback — a participant submits their rating after a
// session. Records the response and refreshes the live aggregates so the cards
// and command centre update automatically. Anonymous allowed (e.g. in-room QR);
// attributed to the lawyer when signed in.
router.post('/:id/feedback', optionalAuth, (req, res) => {
  const b = req.body || {};
  const r = b.ratings || b;
  const has = ['knowledge', 'clarity', 'interaction', 'content', 'benefits', 'practical', 'overall']
    .some((k) => Number(r[k]) >= 1 && Number(r[k]) <= 5);
  if (!has) return res.status(400).json({ error: 'no_ratings', message: 'Provide at least one rating (1–5).' });
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  try {
    const store = require('../../scripts/seed-feedback');
    const result = store.submitResponse(db, {
      courseId: req.params.id, ratings: r, comment: b.comment,
      sessionId: b.session_id || b.sessionId || null,
      lawyerId: (req.user && (req.user.lawyer_id || req.user.id)) || null,
    });
    res.json({ ok: true, submission: result, rating: feedback.courseRating(req.params.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v1/courses/:id
router.get('/:id', optionalAuth, (req, res) => {
  const c = store.getCourseById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  // A private accredited course is only visible to its owning firm / LAD.
  if (!store.canAccessCourse(c, req.user)) return res.status(404).json({ error: 'Course not found' });
  res.json(Object.assign({}, c, { tags: courseTopics(c.id) }));
});

// ─── Course materials (SCORM packages, slides, PDFs) ─────────────────
const MATERIAL_ROLES = ['lad_admin', 'provider_admin', 'lad_super_admin', 'super_admin', 'dg'];
const MAX_INLINE_BYTES = 10 * 1024 * 1024; // 10 MB inline cap; larger → use a link
const _mid = () => 'MT-' + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 10);
const isMaterialAdmin = (u) => !!u && MATERIAL_ROLES.includes(u.role);

// Can this user see/download a course's materials?  Admins always; a lawyer if
// they have a (non-cancelled) booking for the course.
function canAccessMaterials(courseId, user) {
  if (isMaterialAdmin(user)) return true;
  if (user && user.role === 'firm_compliance_officer') return true;
  if (user && user.user_type === 'lawyer') {
    try {
      const b = db.prepare("SELECT 1 FROM bookings WHERE lawyer_id = ? AND course_id = ? AND status NOT IN ('cancelled','refunded') LIMIT 1").get(user.sub, courseId);
      return !!b;
    } catch (_) { return false; }
  }
  return false;
}
const materialMeta = (m) => ({
  id: m.id, course_id: m.course_id, title: m.title, kind: m.kind,
  url: m.kind === 'link' || m.kind === 'scorm' ? (m.url || null) : null,
  file_name: m.file_name || null, mime: m.mime || null, size: Number(m.size) || 0,
  has_file: !!m.data || !!m.storage_key,
  // How the lawyer downloads it: a cloud blob, an inline file, or an external link.
  download_kind: m.storage_key ? 'blob' : (m.data ? 'inline' : 'link'),
  created_at: m.created_at,
});

// POST get a direct-to-Azure upload URL (admin) for large files / SCORM zips.
router.post('/:id/materials/upload-url', requireRole(...MATERIAL_ROLES), async (req, res) => {
  if (!blob.isConfigured()) {
    return res.status(501).json({ error: 'blob_not_configured', message: 'Cloud storage is not configured — upload files up to 10 MB inline, or add a link.' });
  }
  const course = store.getCourseById(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const fileName = (req.body.file_name || 'file').toString();
  const mime = (req.body.mime || 'application/octet-stream').toString();
  try {
    await blob.ensureContainer();
    const key = blob.makeKey(req.params.id, fileName);
    const upload_url = blob.getUploadUrl(key, mime);
    res.json({ upload_url, storage_key: key, blob_type: 'BlockBlob', expires_in_min: 30 });
  } catch (e) {
    res.status(500).json({ error: 'sas_failed', message: e.message });
  }
});

// GET materials list (metadata only — never the inline payload)
router.get('/:id/materials', optionalAuth, (req, res) => {
  const course = store.getCourseById(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (!canAccessMaterials(req.params.id, req.user)) {
    return res.status(403).json({ error: 'no_access', message: 'Book or complete this course to access its materials.' });
  }
  let rows = [];
  try { rows = db.prepare('SELECT * FROM course_materials WHERE course_id = ? ORDER BY created_at').all(req.params.id); } catch (_) {}
  res.json({ materials: rows.map(materialMeta), blob_enabled: blob.isConfigured() });
});

// POST add a material (admin) — a link/SCORM URL, or a small inline file
router.post('/:id/materials', requireRole(...MATERIAL_ROLES), (req, res) => {
  const course = store.getCourseById(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const title = (req.body.title || '').toString().trim();
  if (!title) return res.status(400).json({ error: 'title is required' });
  let kind = (req.body.kind || 'link').toString();
  if (!['link', 'file', 'scorm'].includes(kind)) kind = 'link';
  const url = (req.body.url || '').toString().trim() || null;
  const storageKey = (req.body.storage_key || '').toString().trim() || null; // already uploaded to Azure
  let data = req.body.data ? String(req.body.data) : null; // base64 (may be a data: URL)
  if (data && data.indexOf('base64,') >= 0) data = data.split('base64,').pop();
  if (!url && !data && !storageKey) return res.status(400).json({ error: 'Provide a url (link/SCORM), an uploaded file, or a cloud file.' });
  let size = Number(req.body.size) || 0;
  if (data) {
    size = Math.floor(data.length * 3 / 4);
    if (size > MAX_INLINE_BYTES) {
      return res.status(413).json({ error: 'file_too_large', message: 'File over 10 MB — use the cloud upload, or host it and add it as a link.' });
    }
  }
  const id = _mid();
  try {
    db.prepare(`INSERT INTO course_materials (id, course_id, title, kind, url, file_name, mime, size, data, storage_key, created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.params.id, title, kind, url, (req.body.file_name || null), (req.body.mime || null), size, data, storageKey, (req.user && req.user.sub) || null);
  } catch (e) { return res.status(500).json({ error: 'save_failed', message: e.message }); }
  const row = db.prepare('SELECT * FROM course_materials WHERE id = ?').get(id);
  res.status(201).json(materialMeta(row));
});

// GET download a single material (inline file streamed, or redirect to the URL)
router.get('/:id/materials/:mid/download', optionalAuth, (req, res) => {
  if (!canAccessMaterials(req.params.id, req.user)) {
    return res.status(403).json({ error: 'no_access', message: 'Book or complete this course to access its materials.' });
  }
  const m = db.prepare('SELECT * FROM course_materials WHERE id = ? AND course_id = ?').get(req.params.mid, req.params.id);
  if (!m) return res.status(404).json({ error: 'Material not found' });
  // Blob-backed file → redirect to a short-lived Azure read SAS URL.
  if (m.storage_key) {
    if (!blob.isConfigured()) return res.status(503).json({ error: 'storage_unavailable' });
    try { return res.redirect(blob.getDownloadUrl(m.storage_key, m.file_name || m.title)); }
    catch (e) { return res.status(500).json({ error: 'sas_failed', message: e.message }); }
  }
  if (m.data) {
    const buf = Buffer.from(m.data, 'base64');
    res.setHeader('Content-Type', m.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${(m.file_name || m.title || 'material').replace(/"/g, '')}"`);
    return res.send(buf);
  }
  if (m.url) return res.redirect(m.url);
  res.status(404).json({ error: 'No downloadable content' });
});

// GET a fresh download URL (JSON) for a blob material — lets the browser open it
// directly without sending the auth token to Azure.
router.get('/:id/materials/:mid/download-url', optionalAuth, (req, res) => {
  if (!canAccessMaterials(req.params.id, req.user)) {
    return res.status(403).json({ error: 'no_access', message: 'Book or complete this course to access its materials.' });
  }
  const m = db.prepare('SELECT * FROM course_materials WHERE id = ? AND course_id = ?').get(req.params.mid, req.params.id);
  if (!m) return res.status(404).json({ error: 'Material not found' });
  if (m.storage_key && blob.isConfigured()) {
    try { return res.json({ url: blob.getDownloadUrl(m.storage_key, m.file_name || m.title) }); }
    catch (e) { return res.status(500).json({ error: 'sas_failed', message: e.message }); }
  }
  if (m.url) return res.json({ url: m.url });
  res.status(404).json({ error: 'No direct URL for this material' });
});

// DELETE a material (admin) — also removes the underlying blob if any.
router.delete('/:id/materials/:mid', requireRole(...MATERIAL_ROLES), (req, res) => {
  const m = db.prepare('SELECT storage_key FROM course_materials WHERE id = ? AND course_id = ?').get(req.params.mid, req.params.id);
  const r = db.prepare('DELETE FROM course_materials WHERE id = ? AND course_id = ?').run(req.params.mid, req.params.id);
  if (m && m.storage_key && blob.isConfigured()) { blob.deleteBlob(m.storage_key).catch(() => {}); }
  res.json({ deleted: r.changes });
});

// PUT /api/v1/courses/:id — CMS edit (LAD admin only)
router.put('/:id', requireRole('lad_admin', 'provider_admin'), (req, res) => {
  const merged = { ...req.body, id: req.params.id };
  res.json(store.upsertCourse(merged));
});

// POST /api/v1/courses — create
router.post('/', requireRole('lad_admin', 'provider_admin'), (req, res) => {
  if (!req.body.id || !req.body.title) {
    return res.status(400).json({ error: 'id and title required' });
  }
  res.json(store.upsertCourse(req.body));
});

// DELETE /api/v1/courses/:id
router.delete('/:id', requireRole('lad_admin', 'lad_super_admin', 'super_admin', 'dg'), (req, res) => {
  store.deleteCourse(req.params.id);
  res.json({ ok: true });
});

// ─── Smart meta-tagging ──────────────────────────────────────────────
// POST /api/v1/courses/:id/autotag — suggest taxonomy tags from the course's
// title/description (AiModel, heuristic fallback). Does NOT persist; the admin
// reviews then saves via PUT. Accepts an unsaved draft in the body.
router.post('/:id/autotag', requireRole('lad_admin', 'provider_admin'), async (req, res, next) => {
  const saved = store.getCourseById(req.params.id) || {};
  const course = {
    title:       req.body.title || saved.title,
    description: req.body.description || req.body.desc || saved.description,
    areas:       req.body.areas || req.body.practice_areas || '',
    category:    req.body.category || saved.category,
    matchReason: req.body.matchReason || '',
  };
  if (!course.title) return res.status(400).json({ error: 'A course title is required to tag.' });
  try { res.json(await tagger.suggestTags(course)); }
  catch (e) { next(e); }
});

// GET /api/v1/courses/:id/topics — current confirmed tags
router.get('/:id/topics', requireAuth, (req, res) => res.json({ tags: courseTopics(req.params.id) }));

// PUT /api/v1/courses/:id/topics — persist confirmed tags (replaces the set)
router.put('/:id/topics', requireRole('lad_admin', 'provider_admin'), (req, res) => {
  const courseId = req.params.id;
  const incoming = Array.isArray(req.body.tags) ? req.body.tags : [];
  let valid = new Set();
  try { valid = new Set(db.prepare('SELECT id FROM taxonomies WHERE level = 2').all().map((r) => r.id)); } catch (_) {}
  const clean = [];
  const seen = new Set();
  for (const t of incoming) {
    if (!t || !valid.has(t.topic_id) || seen.has(t.topic_id)) continue;
    seen.add(t.topic_id);
    clean.push({ topic_id: t.topic_id, weight: Math.max(0.1, Math.min(1, Number(t.weight) || 0.5)), source: t.source || 'reviewer' });
  }
  try {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM course_topics WHERE course_id = ?').run(courseId);
      const ins = db.prepare('INSERT OR REPLACE INTO course_topics (course_id, topic_id, weight, source, confirmed_by) VALUES (?,?,?,?,?)');
      for (const t of clean) ins.run(courseId, t.topic_id, t.weight, t.source, req.user.email || req.user.sub || 'admin');
    });
    tx();
  } catch (e) { return res.status(500).json({ error: 'Could not save tags', detail: e.message }); }
  res.json({ ok: true, count: clean.length, tags: courseTopics(courseId) });
});

// ─── Sessions (calendar / schedule) ──────────────────────────────────
// GET  /api/v1/courses/sessions/all
router.get('/sessions/all', optionalAuth, (_req, res) => res.json(store.getSessions()));

// POST /api/v1/courses/sessions/bulk — CMS bulk upsert
router.post('/sessions/bulk', requireRole('lad_admin', 'provider_admin'), (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array expected' });
  res.json(store.bulkUpsertSessions(req.body));
});

module.exports = router;
