'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const { requireRole, optionalAuth } = require('../middleware/auth');

// GET /api/v1/content — public read
router.get('/', optionalAuth, (_req, res) => res.json(store.getContent()));

// PUT /api/v1/content — CMS write
router.put('/', requireRole('lad_admin'), (req, res) => {
  if (typeof req.body !== 'object' || !req.body) {
    return res.status(400).json({ error: 'object expected' });
  }
  res.json(store.saveContent(req.body));
});

module.exports = router;
