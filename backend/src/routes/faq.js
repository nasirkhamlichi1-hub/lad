'use strict';

const express = require('express');
const router = express.Router();
const store = require('../services/store');
const { requireRole, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, (_req, res) => res.json(store.getFAQ()));

router.put('/', requireRole('lad_admin'), (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array expected' });
  res.json(store.saveFAQ(req.body));
});

module.exports = router;
