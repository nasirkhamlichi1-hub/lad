// Admin-gated AiModel connectivity check (no secrets returned).
const S = require('../_shared');
const aimodel = require('../_aimodel');
module.exports = async function (context, req) {
  if (!S.adminOk(req)) return S.json(context, 401, { error: 'Administrator access required.' });
  if (!aimodel.configured()) return S.json(context, 200, { configured: false, ok: false, message: 'No AiModel app settings detected (endpoint + key).' });
  let status = 'unknown';
  const out = await aimodel.callAiModel({ system: 'Connectivity test. Reply with exactly: OK', messages: [{ role: 'user', content: 'ping' }], maxTokens: 8, log: m => { status = String(m); } });
  return S.json(context, 200, { configured: true, ok: !!out, reply: out ? out.slice(0, 40) : null, note: out ? 'AiModel reachable.' : ('AiModel call failed (' + status + ') — check the deployment name / endpoint format.') });
};
