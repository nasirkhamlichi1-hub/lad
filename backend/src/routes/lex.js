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

// Anything that looks like a credential is scrubbed before it can leave this
// process. /lex/health is PUBLIC, and a provider's error text quotes back what
// we sent it — so a key pasted into the wrong setting (e.g. the model name)
// would otherwise be republished to the world. Redact, always, everywhere.
const SECRET_RE = /\b(sk-[A-Za-z0-9_\-]{6,}|xi-[A-Za-z0-9_\-]{12,}|[A-Za-z0-9_\-]{40,})\b/g;
function redact(v) {
  return String(v == null ? '' : v).replace(SECRET_RE, '[redacted]');
}
// Flatten a provider error into one string so it can be redacted before it is
// logged or returned. e.detail is the raw upstream body and may be an object.
function detailText(e) {
  if (!e) return '';
  const d = e.detail;
  if (d == null) return String(e.message || '');
  if (typeof d === 'string') return d;
  if (d.error && d.error.message) return String(d.error.message);
  try { return JSON.stringify(d); } catch (_) { return String(e.message || ''); }
}
// A model name is config, not a secret — but if someone pastes a key into it,
// this keeps the value from being echoed while still naming the mistake.
function safeModelName(v) {
  const s = String(v || '');
  if (/^sk-|^xi-/.test(s) || s.length > 60) return '[redacted — this looks like an API key, not a model name]';
  return s;
}

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
    deployment: safeModelName(s.deployment),
    anthropicModel: safeModelName(config.anthropic.model),
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
      const raw = typeof e.detail === 'object'
        ? (e.detail && e.detail.error ? e.detail.error.message : JSON.stringify(e.detail))
        : e.detail;
      out.probe = { ok: false, code: e.code || 'ERROR', httpStatus: e.status,
        message: redact(e.message),
        detail: redact(raw).slice(0, 300) };
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
      // Provider error bodies quote request context back at you, so they are
      // redacted before they reach a log aggregator or a caller.
      log.error('aimodel_chat', { status: e.status, detail: redact(detailText(e)).slice(0, 500) });
      // Fall through to Claude if available, otherwise the local assistant.
      if (!config.anthropic.apiKey) return localAnswer() || res.status(502).json({ error: 'AiModel call failed', detail: redact(detailText(e)).slice(0, 300) });
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
      const detail = redact(typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {})).slice(0, 300);
      log.error('anthropic_chat', { status: r.status, detail });
      return localAnswer() || res.status(r.status).json({ error: 'Anthropic API error', detail });
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

// GET /api/v1/lex/health — a liveness answer for uptime monitors and for
// opening in a browser tab. It used to return the full diagnostic to anyone,
// which published the internal endpoint host, the deployment name and the API
// version, and fired a live model call on every request — an open, unmetered
// way to spend the Department's AI budget. The detail now lives behind
// /lex/status, which requires a signed-in caller.
router.get('/health', (_req, res) => {
  res.json({ service: 'lex', configured: aimodel.configured(), status: 'ok' });
});

// GET /api/v1/lex/models — which models this key may use, fastest first.
// The trainer's speed is mostly the model's speed, and model names change;
// rather than guessing one, read the list and set TRAINER_BRAIN_MODEL.
router.get('/models', requireAuth, async (_req, res) => {
  const s = aimodel.settings();
  if (!s.anthropicKey) return res.status(501).json({ error: 'No Anthropic key configured' });
  try {
    const r = await axios.get(`${s.anthropicBase}/v1/models?limit=100`, {
      headers: {
        'x-api-key': s.anthropicKey,
        'anthropic-version': '2023-06-01',
        ...(s.anthropicWorkspace ? { 'anthropic-workspace-id': s.anthropicWorkspace } : {}),
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (r.status >= 300) return res.status(502).json({ error: 'models_failed', status: r.status });
    const all = ((r.data && r.data.data) || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
    // Haiku is the quick one, then Sonnet, then the rest.
    const rank = (id) => (/haiku/i.test(id) ? 0 : /sonnet/i.test(id) ? 1 : 2);
    all.sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? 1 : -1));
    res.json({
      current: safeModelName(config.anthropic.model),
      trainerModel: safeModelName(config.trainerBrain.model),
      fastest: all.filter((m) => /haiku/i.test(m.id)).slice(0, 3).map((m) => m.id),
      models: all,
    });
  } catch (e) {
    res.status(502).json({ error: 'models_failed', message: redact(e.message) });
  }
});

module.exports = router;
