'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');

// GET /api/v1/courses — public (used by the public CLPD portal)
router.get('/', optionalAuth, (_req, res) => res.json(store.getCourses()));

// GET /api/v1/courses/:id
router.get('/:id', optionalAuth, (req, res) => {
  const c = store.getCourseById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  res.json(c);
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
router.delete('/:id', requireRole('lad_admin'), (req, res) => {
  store.deleteCourse(req.params.id);
  res.json({ ok: true });
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
