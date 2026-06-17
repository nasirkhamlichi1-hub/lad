'use strict';

// Proxy for the in-portal "Lex" assistant. Keeps API keys on the server,
// prevents abuse, and applies per-role system prompts.
//
// AI engine: AiModel (the Azure model the LAD configured) is used whenever it
// is configured; Anthropic/Claude is an automatic fallback only when AiModel
// is not set. The response is always shaped like the Anthropic Messages API
// ({ content:[{type:'text',text}] }) so existing callers keep working.

const express = require('express');
const axios = require('axios');
const router = express.Router();
const config = require('../config');
const aimodel = require('../services/aimodel');
const { requireAuth } = require('../middleware/auth');

function asAnthropic(text, engine) {
  return {
    content: [{ type: 'text', text: String(text || '') }],
    model: engine,
    engine,
    usage: { output_tokens: undefined },
  };
}

router.post('/chat', requireAuth, async (req, res, next) => {
  const { messages, system, max_tokens } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
  const maxTokens = Math.min(1024, max_tokens || 600);

  // ─── Preferred: AiModel ───────────────────────────────────────────
  if (aimodel.configured()) {
    try {
      const text = await aimodel.chat({
        system,
        messages: messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string'
            ? m.content
            : (Array.isArray(m.content) ? m.content.map((c) => c.text || '').join(' ') : String(m.content || '')),
        })),
        maxTokens,
        temperature: 0.4,
      });
      return res.json(asAnthropic(text, 'aimodel'));
    } catch (e) {
      // Fall through to Claude if available, otherwise surface the error.
      if (!config.anthropic.apiKey) {
        return res.status(502).json({ error: 'AiModel call failed', detail: e.detail || e.message });
      }
    }
  }

  // ─── Fallback: Anthropic / Claude ─────────────────────────────────
  if (!config.anthropic.apiKey) {
    return res.status(503).json({ error: 'No AI model configured (set AiModel keys or ANTHROPIC_API_KEY)' });
  }
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      config.anthropic.model,
      max_tokens: maxTokens,
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
    res.json(Object.assign({ engine: 'claude' }, r.data));
  } catch (e) { next(e); }
});

module.exports = router;
