'use strict';

// Anam — photoreal avatar for the scalable engine.
// ---------------------------------------------------------------------
// Anam renders the realistic talking face in the browser via its JS SDK. The
// SDK connects with a SHORT-LIVED SESSION TOKEN that we mint here server-side,
// so the Anam API key never reaches the browser. We run Anam in "bring-your-own
// brain" style: Claude (services/trainerBrain.js) decides what to say, and the
// browser tells the avatar to speak it — so we only pay Anam for the face.
//
// NOTE: confirm the exact endpoint/payload against current Anam docs
// (https://docs.anam.ai) when you wire your account; the shape below follows
// the documented session-token flow and is isolated here for easy adjustment.

const axios = require('axios');
const config = require('../config');
const log = require('../logger');

const AN = config.anam;

function isConfigured() {
  return !!(AN.apiKey && AN.avatarId);
}

// Mint a session token the browser SDK uses to start the avatar stream.
async function createSessionToken({ name } = {}) {
  if (!isConfigured()) {
    const err = new Error('Anam is not configured');
    err.status = 503;
    throw err;
  }

  // Persona config: a custom persona whose speech we drive ourselves (Claude is
  // the brain). avatarId selects the photoreal face; Anam provides the voice.
  const personaConfig = {
    name: name || AN.name,
    avatarId: AN.avatarId,
    // brain/LLM is supplied by us via the SDK's talk() calls, so no llmId here.
  };
  if (AN.voiceId) personaConfig.voiceId = AN.voiceId; // optional specific Anam voice

  const r = await axios.post(
    `${AN.baseUrl}/v1/auth/session-token`,
    { personaConfig },
    {
      headers: { Authorization: `Bearer ${AN.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 20000,
      validateStatus: () => true,
    }
  );

  if (r.status >= 300) {
    log.error('anam_session_token_failed', { status: r.status, detail: r.data });
    const err = new Error('Anam session-token request failed');
    err.status = 502; err.detail = r.data;
    throw err;
  }
  // Anam returns the token under sessionToken (fall back to token just in case).
  const token = r.data && (r.data.sessionToken || r.data.session_token || r.data.token);
  if (!token) {
    const err = new Error('Anam did not return a session token');
    err.status = 502; err.detail = r.data;
    throw err;
  }
  return { sessionToken: token, avatarId: AN.avatarId, name: personaConfig.name };
}

module.exports = { isConfigured, createSessionToken };
