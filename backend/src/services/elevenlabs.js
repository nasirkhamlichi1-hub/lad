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

// Streams MP3 audio for the given text.
//
// SPEED IS THE FEATURE. Three things make the difference between a trainer
// that feels present and one that feels like a bad phone line:
//   • the /stream endpoint returns audio while it is still being generated,
//   • optimize_streaming_latency trades a sliver of quality for first-byte time,
//   • the flash voice model generates far faster than the multilingual one.
// The response is piped straight through to the browser, so the lawyer hears
// the first syllable long before the last one exists.
async function ttsStream(text) {
  if (!isConfigured()) {
    const err = new Error('ElevenLabs is not configured');
    err.status = 501;
    throw err;
  }
  const url = `${EL.baseUrl}/v1/text-to-speech/${encodeURIComponent(EL.voiceId)}/stream` +
    `?output_format=${encodeURIComponent(EL.outputFormat)}` +
    `&optimize_streaming_latency=${encodeURIComponent(EL.latency)}`;
  const r = await axios.post(
    url,
    {
      text: String(text || ''),
      model_id: EL.modelId,
      voice_settings: { stability: 0.4, similarity_boost: 0.7, speed: EL.speed },
    },
    {
      headers: { 'xi-api-key': EL.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      responseType: 'stream',
      timeout: 30000,
      validateStatus: () => true,
    }
  );
  if (r.status >= 300) {
    let detail = '';
    try {
      const chunks = [];
      for await (const c of r.data) chunks.push(c);
      detail = Buffer.concat(chunks).toString('utf8').slice(0, 300);
    } catch (_) {}
    log.error('elevenlabs_tts_failed', { status: r.status, detail });
    const err = new Error('ElevenLabs TTS failed (' + r.status + ')');
    err.status = 502;
    throw err;
  }
  return r.data; // a readable stream of MP3 bytes
}

module.exports = { isConfigured, ttsStream };
