// Mint a short-lived Anam session token server-side, so the ANAM_API_KEY never
// reaches the browser. The browser SDK uses the returned sessionToken to stream
// the photoreal avatar. Persona defaults to the saved "Liv" persona; override
// with the ANAM_PERSONA_ID app setting.
const S = require('../_shared');

const DEFAULT_PERSONA = '519f0797-bdc5-47da-a752-f2a5c1fc150f';

module.exports = async function (context, req) {
  if (!S.verify((req.body && req.body.token) || '')) return S.json(context, 401, { error: 'Please sign in to start the trainer.' });
  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) return S.json(context, 503, { error: 'AI trainer face not configured (ANAM_API_KEY missing).' });

  const personaId = (req.body && req.body.personaId) || process.env.ANAM_PERSONA_ID || DEFAULT_PERSONA;

  try {
    const r = await fetch('https://api.anam.ai/v1/auth/session-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ personaConfig: { personaId } })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.sessionToken) {
      context.log.error('anam session-token failed', r.status, JSON.stringify(data).slice(0, 300));
      return S.json(context, 502, { error: 'Could not start the avatar session.', status: r.status });
    }
    return S.json(context, 200, { sessionToken: data.sessionToken });
  } catch (e) {
    context.log.error('anam-token error', e && e.message);
    return S.json(context, 502, { error: 'Avatar service unreachable.' });
  }
};
