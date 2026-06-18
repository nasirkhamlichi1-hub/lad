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
const maryamLocal = require('../services/maryam-local');
const log = require('../logger');
const { requireAuth, optionalAuth } = require('../middleware/auth');

// Shared AiModel diagnostic (no key, no secrets) — runs a live 1-token probe
// and reports the exact failure so "Maryam isn't working" can be pinpointed.
async function aimodelDiagnostic() {
  const s = aimodel.settings();
  let host = '';
  try { host = s.endpoint ? new URL(s.endpoint).host : ''; } catch (_) { host = s.endpoint || ''; }
  const isAzure = /openai\.azure\.com/i.test(s.endpoint || '') || /\/openai\/deployments\//i.test(s.endpoint || '');
  let resolvedPath = '';
  try { resolvedPath = aimodel.configured() ? new URL(aimodel.buildRequest(s).url).pathname : ''; } catch (_) {}
  const out = {
    configured: aimodel.configured(),
    endpointHost: host,
    resolvedPath,
    isTunnel: /trycloudflare\.com|ngrok|loca\.lt/i.test(host),
    isAzure,
    deployment: s.deployment,
    apiVersion: s.apiVersion,
    hasKey: !!s.key,
    claudeFallback: !!config.anthropic.apiKey,
    probe: null,
  };
  if (aimodel.configured()) {
    try {
      const text = await aimodel.chat({ messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 5, temperature: 0 });
      out.probe = { ok: true, sample: (text || '').slice(0, 40) };
    } catch (e) {
      out.probe = { ok: false, code: e.code || 'ERROR', httpStatus: e.status,
        message: e.message,
        detail: typeof e.detail === 'object' ? (e.detail.error ? e.detail.error.message : JSON.stringify(e.detail).slice(0, 300)) : String(e.detail || '').slice(0, 300) };
    }
  }
  return out;
}

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

  // Resilient local answer — Maryam never goes dead even if every remote
  // engine is unavailable. Used as the last resort below.
  const localAnswer = () => {
    try {
      const text = maryamLocal.respond(req.user, messages);
      if (text) return res.json(asAnthropic(text, 'assistant-local'));
    } catch (e) { log.error('maryam_local', { error: e.message }); }
    return null;
  };

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
      log.error('aimodel_chat', { status: e.status, detail: e.detail || e.message });
      // Fall through to Claude if available, otherwise the local assistant.
      if (!config.anthropic.apiKey) return localAnswer() || res.status(502).json({ error: 'AiModel call failed', detail: e.detail || e.message });
    }
  }

  // ─── Fallback: Anthropic / Claude ─────────────────────────────────
  if (!config.anthropic.apiKey) {
    return localAnswer() || res.status(503).json({ error: 'No AI model configured (set AiModel keys or ANTHROPIC_API_KEY)' });
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
      return localAnswer() || res.status(r.status).json({ error: 'Anthropic API error', detail: r.data });
    }
    res.json(Object.assign({ engine: 'claude' }, r.data));
  } catch (e) { return localAnswer() || next(e); }
});

// GET /api/v1/lex/status — non-secret diagnostic for "Maryam isn't working".
// Reports whether AiModel is configured, which endpoint host/deployment it is
// using, and the result of a live 1-token probe — so the exact failure
// (dead tunnel, wrong deployment, bad key) is visible without exposing the key.
router.get('/status', requireAuth, async (_req, res) => {
  res.json(await aimodelDiagnostic());
});

// GET /api/v1/lex/health — same diagnostic, public, so it can be opened
// directly in a browser tab (no auth header needed). Leaks no credentials.
router.get('/health', optionalAuth, async (_req, res) => {
  res.json(await aimodelDiagnostic());
});

module.exports = router;
