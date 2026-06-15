const S = require('../_shared');

// Server-side text-to-speech via ElevenLabs. Keeps the API key on the server
// and returns base64 MP3 audio, which is the most reliable path on mobile.
module.exports = async function (context, req) {
  const b = req.body || {};
  const text = String(b.text || '').slice(0, 5000).trim();
  if (!text) return S.json(context, 400, { error: 'No text provided.' });

  const key = process.env.ELEVEN_API_KEY || '';
  if (!key) return S.json(context, 500, { error: 'Voice service is not configured.' });

  const voice = process.env.ELEVEN_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  const url = 'https://api.elevenlabs.io/v1/text-to-speech/' + voice + '?output_format=mp3_44100_128';

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true }
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      context.log('ElevenLabs error', r.status, detail);
      return S.json(context, 502, { error: 'Voice service returned ' + r.status });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return S.json(context, 200, { audio: buf.toString('base64') });
  } catch (e) {
    context.log('TTS exception', e && e.message);
    return S.json(context, 500, { error: 'Could not generate audio.' });
  }
};
