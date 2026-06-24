'use strict';

// Knowledge hubs — the public reference page that fronts the AI trainer for a
// course. One hub per course_id; the trainer's lessons (same course_id) are the
// shared content, so one upload drives both.
//
//   GET  /api/v1/hubs              admin  — courses an admin can manage (hub + lessons)
//   GET  /api/v1/hubs/:courseId    public — assembled hub (content + course lessons)
//   PUT  /api/v1/hubs/:courseId    admin  — create / update a hub

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
  res.json(hub);
});

// Admin: upsert the hub for a course.
router.put('/:courseId', requireRole(...ADMIN_ROLES), (req, res) => {
  const body = Object.assign({}, req.body, { course_id: req.params.courseId });
  if (!String(body.title || '').trim()) return res.status(400).json({ error: 'A hub title is required' });
  try {
    const saved = hubStore.upsertHub(body, req.user.sub || req.user.id);
    saved.lessons = hubStore.lessonsForCourse(req.params.courseId);
    res.json(saved);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save hub' });
  }
});

module.exports = router;
