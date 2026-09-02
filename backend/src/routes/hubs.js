'use strict';

// Knowledge hubs — the public reference page that fronts the AI trainer for a
// course. One hub per course_id; the trainer's lessons (same course_id) are the
// shared content, so one upload drives both.
//
//   GET  /api/v1/hubs                   admin  — courses an admin can manage (hub + lessons)
//   GET  /api/v1/hubs/:courseId         public — assembled hub (content + course lessons)
//   PUT  /api/v1/hubs/:courseId         admin  — create / update a hub
//   GET  /api/v1/hubs/:courseId/hero    public — the hub's hero photo (no auth: it is a CSS background)
//   POST /api/v1/hubs/:courseId/hero    admin  — upload that photo
//   DELETE /api/v1/hubs/:courseId/hero  admin  — remove it

const express = require('express');
const router = express.Router();
const hubStore = require('../services/hubStore');
const { requireRole, optionalAuth } = require('../middleware/auth');

const ADMIN_ROLES = ['lad_admin', 'lad_super_admin', 'super_admin', 'dg'];

// Admin: every course that has lessons or a hub, with status.
router.get('/', requireRole(...ADMIN_ROLES), (_req, res) => {
  res.json({ courses: hubStore.coursesOverview() });
});

// Public: the assembled hub for one course. Drafts are only visible to admins.
router.get('/:courseId', optionalAuth, (req, res) => {
  const isAdmin = req.user && ADMIN_ROLES.includes(req.user.role);
  const hub = hubStore.getHub(req.params.courseId);
  if (!hub) return res.status(404).json({ error: 'Hub not found' });
  if (!hub.published && !isAdmin) return res.status(404).json({ error: 'Hub not published' });
  hub.lessons = hubStore.lessonsForCourse(req.params.courseId);
  hub.hero_url = heroUrl(req, hub);
  res.json(hub);
});

// The hero is a CSS background on a page served from another origin, so the
// client needs the whole address, not a path — and a cache-buster tied to the
// last save, so a replaced photo shows up immediately instead of days later.
function heroUrl(req, hub) {
  if (!hub || !hub.has_hero_upload) return hub && hub.hero_image ? hub.hero_image : '';
  const origin = `${req.protocol}://${req.get('host')}`;
  const v = encodeURIComponent(String(hub.hero_updated_at || '').replace(/\D/g, '') || '1');
  return `${origin}/api/v1/hubs/${encodeURIComponent(hub.course_id)}/hero?v=${v}`;
}

// Public on purpose: a background image request carries no Authorization
// header. Nothing here is sensitive — it is the picture chosen to sit behind a
// course title — and it is only ever reachable by exact course id.
router.get('/:courseId/hero', (req, res) => {
  const hero = hubStore.getHero(req.params.courseId);
  if (!hero) return res.status(404).json({ error: 'No hero image for this hub' });
  res.set('Content-Type', hero.mime);
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(hero.data);
});

router.post('/:courseId/hero', requireRole(...ADMIN_ROLES), (req, res) => {
  const b = req.body || {};
  let buf;
  try { buf = Buffer.from(String(b.data || ''), 'base64'); }
  catch (_) { return res.status(400).json({ error: 'Could not read that image.' }); }
  try {
    const saved = hubStore.setHero(req.params.courseId, buf, b.mime);
    res.json({ ok: true, hero_url: heroUrl(req, saved) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save that image.' });
  }
});

router.delete('/:courseId/hero', requireRole(...ADMIN_ROLES), (req, res) => {
  hubStore.clearHero(req.params.courseId);
  res.json({ ok: true });
});

// Admin: upsert the hub for a course.
router.put('/:courseId', requireRole(...ADMIN_ROLES), (req, res) => {
  const body = Object.assign({}, req.body, { course_id: req.params.courseId });
  if (!String(body.title || '').trim()) return res.status(400).json({ error: 'A hub title is required' });
  try {
    const saved = hubStore.upsertHub(body, req.user.sub || req.user.id);
    saved.lessons = hubStore.lessonsForCourse(req.params.courseId);
    saved.hero_url = heroUrl(req, saved);
    res.json(saved);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save hub' });
  }
});

module.exports = router;
