// Academy voice — server-side ElevenLabs proxy using ELEVENLABS_API_KEY.
// If the key isn't set, returns 503 and the browser falls back to built-in speech.
// Returns the audio as base64 JSON for reliable transport through SWA.
const S = require('../_shared');

module.exports = async function (context, req) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return S.json(context, 503, { error: 'voice not configured' });

  const b = req.body || {};
  if (!S.verify(b.token || '')) return S.json(context, 401, { error: 'Please sign in again.' });
  const text = String(b.text || '').slice(0, 1500);
  if (!text.trim()) return S.json(context, 400, { error: 'no text' });

  const lang = (b.lang === 'ar') ? 'ar' : 'en';
  const voice = (lang === 'ar' && process.env.ELEVENLABS_VOICE_AR) ? process.env.ELEVENLABS_VOICE_AR
              : (process.env.ELEVENLABS_VOICE || 'EXAVITQu4vr4xnSDxMaL');
  const model = (lang === 'ar') ? (process.env.ELEVENLABS_MODEL_AR || 'eleven_multilingual_v2') : 'eleven_turbo_v2_5';
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voice, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', 'accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.4, similarity_boost: 0.7 } })
    });
    if (!r.ok) { context.log.error('tts upstream', r.status); return S.json(context, 502, { error: 'tts upstream' }); }
    const buf = Buffer.from(await r.arrayBuffer());
    return S.json(context, 200, { audio: buf.toString('base64') });
  } catch (e) {
    context.log.error('tts error', e && e.message);
    return S.json(context, 500, { error: 'server' });
  }
};
