// Academy AI coach — server-side proxy to Claude using the app's ANTHROPIC_API_KEY
// (the same key Maryam uses). So every trainee gets the conversational coach with
// nothing to configure. Restricted to signed-in academy users (token verified).
const S = require('../_shared');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

module.exports = async function (context, req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return S.json(context, 503, { error: 'AI coach not configured.' });

  const b = req.body || {};
  if (!S.verify(b.token || '')) return S.json(context, 401, { error: 'Please sign in again.' });

  let messages = Array.isArray(b.messages) ? b.messages : null;
  if (!messages) return S.json(context, 400, { error: 'messages required' });
  const clean = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16).map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') return S.json(context, 400, { error: 'bad messages' });

  const system = String(b.system || '').slice(0, 12000);
  const max_tokens = Math.min(1200, Math.max(64, parseInt(b.max_tokens, 10) || 900));
  // Try the requested model, then fall back to known-good models (opus is the one Maryam uses).
  const wanted = /^claude-[a-z0-9.\-]+$/i.test(b.model || '') ? b.model : 'claude-sonnet-4-6';
  const models = [wanted, 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'].filter((m, i, a) => a.indexOf(m) === i);

  let lastStatus = 0, lastDetail = '';
  for (const model of models) {
    try {
      const r = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens, system, messages: clean })
      });
      if (r.ok) {
        const data = await r.json();
        const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
        return S.json(context, 200, { text, model });
      }
      lastStatus = r.status; lastDetail = await r.text().catch(() => '');
      if (r.status === 401 || r.status === 403) break; // bad key — no point retrying
    } catch (e) { lastDetail = e && e.message; }
  }
  context.log.error('coach upstream failed', lastStatus, lastDetail);
  return S.json(context, 502, { error: 'upstream', status: lastStatus });
};
