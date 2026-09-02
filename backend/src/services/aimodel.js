'use strict';

// ─────────────────────────────────────────────────────────────────────
// AiModel client — the Azure-hosted model the LAD set up for data-analysis
// features (accreditation AI review, dashboards). OpenAI chat-completions
// shape; Azure OpenAI is auto-detected from the endpoint host.
//
// Configuration is read from a generous set of env aliases so it works with
// whatever names were used in the Azure portal:
//   endpoint   : AIMODEL_ENDPOINT | AZURE_OPENAI_ENDPOINT | OPENAI_ENDPOINT |
//                OPENAI_BASE_URL | AOAI_ENDPOINT | AI_ENDPOINT | AI_MODEL_ENDPOINT
//   key        : AIMODEL_KEY | AIMODEL_API_KEY | AZURE_OPENAI_KEY |
//                AZURE_OPENAI_API_KEY | OPENAI_API_KEY | OPENAI_KEY |
//                AOAI_KEY | AI_KEY | AI_MODEL_KEY
//   deployment : AIMODEL_DEPLOYMENT | AIMODEL_MODEL | AZURE_OPENAI_DEPLOYMENT |
//                AZURE_OPENAI_DEPLOYMENT_NAME | AZURE_OPENAI_MODEL |
//                OPENAI_MODEL | OPENAI_DEPLOYMENT | AOAI_DEPLOYMENT |
//                AI_MODEL | AI_DEPLOYMENT | AI_MODEL_NAME
//   apiVersion : AIMODEL_API_VERSION | AZURE_OPENAI_API_VERSION
//                (default 2024-08-01-preview)
//
// If no OpenAI-style endpoint is set but ANTHROPIC_API_KEY is, chat() routes
// to Claude instead — so one Anthropic key powers every AI feature (trainer
// brain, drafting, accreditation review) without any Azure setup. And if an
// endpoint IS set but the call to it fails (dead dev tunnel, wrong deployment,
// expired key), chat() falls back to Claude rather than failing the feature —
// stale env vars must never take the platform down.
// ─────────────────────────────────────────────────────────────────────

const axios = require('axios');

function env(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

function settings() {
  const endpoint = env(['AIMODEL_ENDPOINT', 'INTERNALAI__AIURL', 'InternalAI__AiUrl',
    'AZURE_OPENAI_ENDPOINT', 'OPENAI_ENDPOINT',
    'OPENAI_BASE_URL', 'AOAI_ENDPOINT', 'AI_ENDPOINT', 'AI_MODEL_ENDPOINT']);
  const key = env(['AIMODEL_KEY', 'AIMODEL_API_KEY', 'INTERNALAI__APIKEY', 'InternalAI__ApiKey',
    'AZURE_OPENAI_KEY', 'AZURE_OPENAI_API_KEY',
    'OPENAI_API_KEY', 'OPENAI_KEY', 'AOAI_KEY', 'AI_KEY', 'AI_MODEL_KEY']);
  const deployment = env(['AIMODEL_DEPLOYMENT', 'AIMODEL_MODEL', 'INTERNALAI__AIMODEL', 'InternalAI__AiModel',
    'AZURE_OPENAI_DEPLOYMENT',
    'AZURE_OPENAI_DEPLOYMENT_NAME', 'AZURE_OPENAI_MODEL', 'OPENAI_MODEL', 'OPENAI_DEPLOYMENT',
    'AOAI_DEPLOYMENT', 'AI_MODEL', 'AI_DEPLOYMENT', 'AI_MODEL_NAME']) || 'gpt-4o';
  const apiVersion = env(['AIMODEL_API_VERSION', 'INTERNALAI__APIVERSION', 'InternalAI__ApiVersion',
    'AZURE_OPENAI_API_VERSION']) || '2024-08-01-preview';
  const anthropicKey = env(['ANTHROPIC_API_KEY']);
  const anthropicWorkspace = env(['ANTHROPIC_WORKSPACE_ID']);
  const anthropicModel = env(['ANTHROPIC_MODEL']) || 'claude-sonnet-4-6';
  const anthropicBase = (env(['ANTHROPIC_BASE_URL']) || 'https://api.anthropic.com').replace(/\/+$/, '');
  return { endpoint: endpoint.replace(/\/+$/, ''), key, deployment, apiVersion,
    anthropicKey, anthropicModel, anthropicBase, anthropicWorkspace };
}

function configured() {
  const s = settings();
  return !!(s.endpoint && s.key) || !!s.anthropicKey;
}

// Build the request URL tolerant of whatever was pasted into the endpoint:
//   • bare Azure base        https://x.openai.azure.com
//   • Azure base + path      https://x.openai.azure.com/openai/deployments/gpt-4o
//   • full Azure Target URI  https://x.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=...
//   • OpenAI-compatible base https://host  or  https://host/v1
//   • full OpenAI URL        https://host/v1/chat/completions
function buildRequest(s) {
  let ep = (s.endpoint || '').trim().replace(/\/+$/, '');
  const isAzure = /openai\.azure\.com/i.test(ep) || /\/openai\/deployments\//i.test(ep);

  if (isAzure) {
    const headers = { 'api-key': s.key, 'Content-Type': 'application/json' };
    let url;
    if (/\/chat\/completions/i.test(ep)) {
      url = ep; // full Target URI pasted — use as-is
    } else if (/\/openai\/deployments\/[^/]+/i.test(ep)) {
      url = ep.split('?')[0] + '/chat/completions'; // base + deployment path
    } else {
      url = `${ep}/openai/deployments/${encodeURIComponent(s.deployment)}/chat/completions`;
    }
    if (!/api-version=/i.test(url)) url += (url.includes('?') ? '&' : '?') + 'api-version=' + s.apiVersion;
    return { url, headers, isAzure: true };
  }

  // OpenAI-compatible gateway
  const headers = { authorization: 'Bearer ' + s.key, 'Content-Type': 'application/json' };
  let url;
  if (/\/chat\/completions/i.test(ep)) url = ep;
  else if (/\/v1$/i.test(ep)) url = ep + '/chat/completions';
  else url = ep + '/v1/chat/completions';
  return { url, headers, isAzure: false };
}

// Claude (Anthropic messages API) — used when only ANTHROPIC_API_KEY is set.
// Anthropic wants system as a top-level field and strictly user/assistant
// roles in messages, so anything else is folded into a user turn.
async function anthropicChat(s, { system, messages, maxTokens, temperature }) {
  const msgs = (messages || []).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  })).filter((m) => m.content);
  if (!msgs.length) msgs.push({ role: 'user', content: 'Begin.' });

  const body = { model: s.anthropicModel, max_tokens: maxTokens, temperature, messages: msgs };
  if (system) body.system = system;

  const r = await axios.post(`${s.anthropicBase}/v1/messages`, body, {
    headers: {
      'x-api-key': s.anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      ...(s.anthropicWorkspace ? { 'anthropic-workspace-id': s.anthropicWorkspace } : {}),
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    const e = new Error('AiModel error ' + r.status);
    e.code = 'AIMODEL_ERROR';
    e.status = r.status;
    e.detail = r.data;
    throw e;
  }
  const text = r.data && Array.isArray(r.data.content) && r.data.content[0] &&
    r.data.content[0].text;
  return (text || '').trim();
}

// Streams Claude's reply, calling onDelta(textSoFar, chunk) as it arrives.
//
// This is what removes the dead air. Without it the server waits for the whole
// reply before the browser can say a word; with it the first sentence is in
// hand — and already being turned into speech — while the model is still
// finishing the thought.
async function anthropicChatStream(s, { system, messages, maxTokens, temperature }, onDelta) {
  const msgs = (messages || []).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  })).filter((m) => m.content);
  if (!msgs.length) msgs.push({ role: 'user', content: 'Begin.' });

  const body = { model: s.anthropicModel, max_tokens: maxTokens, temperature, messages: msgs, stream: true };
  if (system) body.system = system;

  const r = await axios.post(`${s.anthropicBase}/v1/messages`, body, {
    headers: {
      'x-api-key': s.anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      ...(s.anthropicWorkspace ? { 'anthropic-workspace-id': s.anthropicWorkspace } : {}),
    },
    responseType: 'stream',
    timeout: 60000,
    validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    let detail = '';
    try { for await (const c of r.data) detail += c.toString('utf8'); } catch (_) {}
    const e = new Error('AiModel error ' + r.status);
    e.code = 'AIMODEL_ERROR'; e.status = r.status; e.detail = detail.slice(0, 300);
    throw e;
  }

  let buf = '', text = '';
  for await (const chunk of r.data) {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(payload); } catch (_) { continue; }
      if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') {
        text += ev.delta.text;
        if (onDelta) { try { onDelta(text, ev.delta.text); } catch (_) {} }
      }
    }
  }
  return text.trim();
}

// chat(), but delivering the reply as it is written. Falls back to a single
// call for OpenAI-style endpoints, which this deployment does not use.
async function chatStream(opts, onDelta) {
  const s = settings();
  if ((!s.endpoint || !s.key) && s.anthropicKey) {
    return anthropicChatStream(s, {
      system: opts.system, messages: opts.messages,
      maxTokens: opts.maxTokens || 700, temperature: opts.temperature == null ? 0.2 : opts.temperature,
    }, onDelta);
  }
  const text = await chat(opts);
  if (onDelta) { try { onDelta(text, text); } catch (_) {} }
  return text;
}

// Returns the assistant's text reply, or throws.
async function chat({ system, messages, maxTokens = 700, temperature = 0.2 }) {
  const s = settings();
  if (!s.endpoint || !s.key) {
    if (s.anthropicKey) return anthropicChat(s, { system, messages, maxTokens, temperature });
    const e = new Error('AiModel is not configured');
    e.code = 'AIMODEL_NOT_CONFIGURED';
    throw e;
  }

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of (messages || [])) msgs.push(m);

  const { url, headers, isAzure } = buildRequest(s);

  const body = { messages: msgs, max_tokens: maxTokens, temperature };
  if (!isAzure) body.model = s.deployment;

  let r;
  try {
    r = await axios.post(url, body, { headers, timeout: 30000, validateStatus: () => true });
  } catch (netErr) {
    // The endpoint itself is unreachable (DNS gone, connection refused, timeout)
    // — typical of a dev tunnel that died. Use Claude if a key is available.
    if (s.anthropicKey) return anthropicChat(s, { system, messages, maxTokens, temperature });
    const e = new Error('The configured AI endpoint is unreachable (' + (netErr.code || netErr.message) + ')');
    e.code = 'AIMODEL_UNREACHABLE';
    e.detail = { endpoint: s.endpoint };
    throw e;
  }
  if (r.status < 200 || r.status >= 300) {
    // The endpoint answered but refused (bad key, wrong deployment, model gone).
    if (s.anthropicKey) return anthropicChat(s, { system, messages, maxTokens, temperature });
    const e = new Error('AiModel error ' + r.status);
    e.code = 'AIMODEL_ERROR';
    e.status = r.status;
    e.detail = r.data;
    throw e;
  }
  const text = r.data && r.data.choices && r.data.choices[0] &&
    r.data.choices[0].message && r.data.choices[0].message.content;
  return (text || '').trim();
}

module.exports = { configured, chat, chatStream, settings, buildRequest };
