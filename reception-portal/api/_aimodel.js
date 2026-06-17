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
function configured() {
  return !!(process.env.AIMODEL_ENDPOINT && process.env.AIMODEL_KEY);
}

async function callAiModel(opts) {
  opts = opts || {};
  const endpoint = String(process.env.AIMODEL_ENDPOINT || '').replace(/\/+$/, '');
  const key = process.env.AIMODEL_KEY || '';
  const model = process.env.AIMODEL_DEPLOYMENT || process.env.AIMODEL_MODEL || '';
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
    const ver = process.env.AIMODEL_API_VERSION || '2024-08-01-preview';
    url = endpoint + '/openai/deployments/' + encodeURIComponent(model || 'gpt-4o') + '/chat/completions?api-version=' + ver;
    headers = { 'content-type': 'application/json', 'api-key': key };
  } else {
    url = /\/chat\/completions/i.test(endpoint) ? endpoint : (endpoint + '/v1/chat/completions');
    headers = { 'content-type': 'application/json', 'authorization': 'Bearer ' + key };
  }

  const body = { messages: msgs, max_tokens: opts.maxTokens || 700, temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3 };
  if (!isAzure && model) body.model = model;

  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) { if (opts.log) opts.log('aimodel ' + r.status); return null; }
    const d = await r.json();
    const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    return (typeof txt === 'string' && txt.trim()) ? txt.trim() : null;
  } catch (e) { if (opts.log) opts.log('aimodel ' + (e && e.message)); return null; }
}

module.exports = { callAiModel, configured };
