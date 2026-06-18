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
  return { endpoint: endpoint.replace(/\/+$/, ''), key, deployment, apiVersion };
}

function configured() {
  const s = settings();
  return !!(s.endpoint && s.key);
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

  const { url, headers, isAzure } = buildRequest(s);

  const body = { messages: msgs, max_tokens: maxTokens, temperature };
  if (!isAzure) body.model = s.deployment;

  const r = await axios.post(url, body, { headers, timeout: 30000, validateStatus: () => true });
  if (r.status < 200 || r.status >= 300) {
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

module.exports = { configured, chat, settings, buildRequest };
