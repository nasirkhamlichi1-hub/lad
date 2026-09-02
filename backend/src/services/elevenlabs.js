'use strict';

// ElevenLabs — the trainer's VOICE.
// ---------------------------------------------------------------------
// Same voice stack as the Wonder Academy build. The API key stays on the
// server: the browser asks /api/v1/trainer/tts for a line of speech and
// gets back an MP3 stream minted here. If the key is not set, the route
// answers 501 and the browser falls back to its built-in voice, so the
// lesson always runs.

const axios = require('axios');
const config = require('../config');
const log = require('../logger');

const EL = config.elevenlabs;

function isConfigured() {
  return !!EL.apiKey;
}

// Returns a Buffer of MP3 audio for the given text, or throws.
async function tts(text) {
  if (!isConfigured()) {
    const err = new Error('ElevenLabs is not configured');
    err.status = 501;
    throw err;
  }
  const r = await axios.post(
    `${EL.baseUrl}/v1/text-to-speech/${encodeURIComponent(EL.voiceId)}?output_format=mp3_44100_128`,
    {
      text: String(text || ''),
      model_id: EL.modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: { 'xi-api-key': EL.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      responseType: 'arraybuffer',
      timeout: 30000,
      validateStatus: () => true,
    }
  );
  if (r.status >= 300) {
    let detail = '';
    try { detail = Buffer.from(r.data).toString('utf8').slice(0, 300); } catch (_) {}
    log.error('elevenlabs_tts_failed', { status: r.status, detail });
    const err = new Error('ElevenLabs TTS failed (' + r.status + ')');
    err.status = 502;
    throw err;
  }
  return Buffer.from(r.data);
}

module.exports = { isConfigured, tts };
