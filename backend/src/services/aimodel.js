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
  const endpoint = env(['AIMODEL_ENDPOINT', 'AZURE_OPENAI_ENDPOINT', 'OPENAI_ENDPOINT',
    'OPENAI_BASE_URL', 'AOAI_ENDPOINT', 'AI_ENDPOINT', 'AI_MODEL_ENDPOINT']);
  const key = env(['AIMODEL_KEY', 'AIMODEL_API_KEY', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_API_KEY',
    'OPENAI_API_KEY', 'OPENAI_KEY', 'AOAI_KEY', 'AI_KEY', 'AI_MODEL_KEY']);
  const deployment = env(['AIMODEL_DEPLOYMENT', 'AIMODEL_MODEL', 'AZURE_OPENAI_DEPLOYMENT',
    'AZURE_OPENAI_DEPLOYMENT_NAME', 'AZURE_OPENAI_MODEL', 'OPENAI_MODEL', 'OPENAI_DEPLOYMENT',
    'AOAI_DEPLOYMENT', 'AI_MODEL', 'AI_DEPLOYMENT', 'AI_MODEL_NAME']) || 'gpt-4o';
  const apiVersion = env(['AIMODEL_API_VERSION', 'AZURE_OPENAI_API_VERSION']) || '2024-08-01-preview';
  return { endpoint: endpoint.replace(/\/+$/, ''), key, deployment, apiVersion };
}

function configured() {
  const s = settings();
  return !!(s.endpoint && s.key);
}

// Returns the assistant's text reply, or throws.
async function chat({ system, messages, maxTokens = 700, temperature = 0.2 }) {
  const s = settings();
  if (!s.endpoint || !s.key) {
    const e = new Error('AiModel is not configured');
    e.code = 'AIMODEL_NOT_CONFIGURED';
    throw e;
  }

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of (messages || [])) msgs.push(m);

  const isAzure = /openai\.azure\.com/i.test(s.endpoint) || /\/openai\/deployments\//i.test(s.endpoint);
  let url, headers;
  if (isAzure) {
    url = `${s.endpoint}/openai/deployments/${encodeURIComponent(s.deployment)}/chat/completions?api-version=${s.apiVersion}`;
    headers = { 'api-key': s.key, 'Content-Type': 'application/json' };
  } else {
    url = `${s.endpoint}/v1/chat/completions`;
    headers = { authorization: 'Bearer ' + s.key, 'Content-Type': 'application/json' };
  }

  const body = { messages: msgs, max_tokens: maxTokens, temperature };
  if (!isAzure) body.model = s.deployment;

  const r = await axios.post(url, body, { headers, timeout: 30000, validateStatus: () => true });
  if (r.status < 200 || r.status >= 300) {
    const e = new Error('AiModel error ' + r.status);
    e.code = 'AIMODEL_ERROR';
    e.detail = r.data;
    throw e;
  }
  const text = r.data && r.data.choices && r.data.choices[0] &&
    r.data.choices[0].message && r.data.choices[0].message.content;
  return (text || '').trim();
}

module.exports = { configured, chat, settings };
