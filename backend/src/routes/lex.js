'use strict';

// Proxy for the in-portal "Lex" assistant. Keeps the Anthropic API key on the
// server, prevents abuse, and lets us add per-role system prompts later.

const express = require('express');
const axios = require('axios');
const router = express.Router();
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

router.post('/chat', requireAuth, async (req, res, next) => {
  if (!config.anthropic.apiKey) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }
  const { messages, system, max_tokens } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      config.anthropic.model,
      max_tokens: Math.min(1024, max_tokens || 600),
      system:     system || undefined,
      messages,
    }, {
      headers: {
        'x-api-key':         config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (r.status !== 200) {
      return res.status(r.status).json({ error: 'Anthropic API error', detail: r.data });
    }
    res.json(r.data);
  } catch (e) { next(e); }
});

module.exports = router;
