// Shared "AiModel" client — the non-Claude model that powers Maryam and the
// data-analysis features. Configured entirely via app settings, so the secret
// never lives in the repo:
//
//   AIMODEL_ENDPOINT     Azure OpenAI resource base, e.g.
//                        https://my-aoai.openai.azure.com
//                        (or any OpenAI-compatible chat-completions base/URL)
//   AIMODEL_DEPLOYMENT   the deployment / model name, e.g. gpt-4o, gpt-4.1
//   AIMODEL_KEY          the API key
//   AIMODEL_API_VERSION  (Azure only) defaults to 2024-08-01-preview
//
// Returns the assistant's text, or null if it's not configured or the call
// fails — callers fall back to Claude so nothing breaks until it's switched on.
// Picks the first non-empty value among several candidate app-setting names, so
// whatever convention you used in Azure works without renaming.
function env(names) { for (let i = 0; i < names.length; i++) { const v = process.env[names[i]]; if (v && String(v).trim()) return String(v).trim(); } return ''; }
function aiEndpoint() { return env(['AIMODEL_ENDPOINT', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_BASE', 'OPENAI_ENDPOINT', 'OPENAI_BASE_URL', 'AOAI_ENDPOINT', 'AI_ENDPOINT', 'AI_MODEL_ENDPOINT']).replace(/\/+$/, ''); }
function aiKey() { return env(['AIMODEL_KEY', 'AIMODEL_API_KEY', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_KEY', 'AOAI_KEY', 'AI_KEY', 'AI_MODEL_KEY']); }
function aiModelName() { return env(['AIMODEL_DEPLOYMENT', 'AIMODEL_MODEL', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_DEPLOYMENT_NAME', 'AZURE_OPENAI_MODEL', 'OPENAI_MODEL', 'OPENAI_DEPLOYMENT', 'AOAI_DEPLOYMENT', 'AI_MODEL', 'AI_DEPLOYMENT', 'AI_MODEL_NAME']); }
function aiApiVersion() { return env(['AIMODEL_API_VERSION', 'AZURE_OPENAI_API_VERSION', 'OPENAI_API_VERSION']) || '2024-08-01-preview'; }

function configured() {
  return !!(aiEndpoint() && aiKey());
}

async function callAiModel(opts) {
  opts = opts || {};
  const endpoint = aiEndpoint();
  const key = aiKey();
  const model = aiModelName();
  if (!endpoint || !key) return null;

  const msgs = [];
  if (opts.system) msgs.push({ role: 'system', content: String(opts.system) });
  (opts.messages || []).forEach(m => {
    if (!m || typeof m.content !== 'string') return;
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  });

  const isAzure = /openai\.azure\.com/i.test(endpoint) || process.env.AIMODEL_AZURE === '1';
  let url, headers;
  if (isAzure) {
    url = endpoint + '/openai/deployments/' + encodeURIComponent(model || 'gpt-4o') + '/chat/completions?api-version=' + aiApiVersion();
    headers = { 'content-type': 'application/json', 'api-key': key };
  } else {
    url = /\/chat\/completions/i.test(endpoint) ? endpoint : (endpoint + '/v1/chat/completions');
    headers = { 'content-type': 'application/json', 'authorization': 'Bearer ' + key };
  }

  const body = { messages: msgs, max_tokens: opts.maxTokens || 700, temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3 };
  if (!isAzure && model) body.model = model;

  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) { if (opts.log) opts.log('aimodel ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200)); return null; }
    const d = await r.json();
    const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    return (typeof txt === 'string' && txt.trim()) ? txt.trim() : null;
  } catch (e) { if (opts.log) opts.log('aimodel ' + (e && e.message)); return null; }
}

module.exports = { callAiModel, configured };
