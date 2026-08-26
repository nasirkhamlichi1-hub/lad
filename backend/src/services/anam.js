'use strict';

// Anam — photoreal avatar (face + voice) for every learning bot.
// ---------------------------------------------------------------------
// Anam renders the realistic talking face in the browser via its JS SDK. The
// SDK connects with a SHORT-LIVED SESSION TOKEN that we mint here server-side,
// so the Anam API key never reaches the browser. We run Anam in "bring your own
// brain" mode: Claude (services/trainerBrain.js) decides what to say and the
// browser streams that text to the avatar to speak — so we only pay Anam for
// the face and the voice.
//
// Which face and voice you get is per-bot (services/botRegistry.js); this
// module only knows how to turn a bot into a session token.

const axios = require('axios');
const config = require('../config');
const log = require('../logger');
const botRegistry = require('./botRegistry');

const AN = config.anam;

function isConfigured() {
  return !!(AN.apiKey && AN.avatarId);
}

// Build the personaConfig Anam expects for a bring-your-own-brain session.
//
// llmId is REQUIRED here, for two separate reasons:
//   1. 'CUSTOMER_CLIENT_V1' disables Anam's own hosted LLM. Without it Anam
//      answers the learner as well as our Claude brain does, and the learner
//      hears two different replies to the same question.
//   2. An inline personaConfig (avatarId + voiceId) with no llmId is rejected
//      by Anam as a legacy token.
// Set ANAM_LLM_ID='' to omit the field if Anam ever changes this contract.
// personaConfig.name is the PERSONA's name — the name the avatar answers to,
// not the learner's. (This used to be handed the lawyer's name, which made the
// trainer introduce itself as the person it was teaching.)
function buildPersonaConfig(bot) {
  const personaConfig = {
    name: bot.name || AN.name,
    avatarId: bot.avatarId || AN.avatarId,
  };
  const voiceId = bot.voiceId || AN.voiceId;
  if (voiceId) personaConfig.voiceId = voiceId;
  if (AN.llmId) personaConfig.llmId = AN.llmId;
  return personaConfig;
}

// Mint a session token the browser SDK uses to start this bot's avatar stream.
// `bot` may be a bot object, a bot id, or omitted for the default bot.
async function createSessionToken({ bot } = {}) {
  if (!isConfigured()) {
    const err = new Error('Anam is not configured');
    err.status = 503;
    throw err;
  }

  const resolved = (bot && typeof bot === 'object') ? bot : botRegistry.resolve(bot);
  if (!resolved) {
    const err = new Error('Unknown learning bot');
    err.status = 404;
    throw err;
  }

  const personaConfig = buildPersonaConfig(resolved);

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
    log.error('anam_session_token_failed', {
      status: r.status, botId: resolved.id, detail: r.data,
    });
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
  return {
    sessionToken: token,
    botId: resolved.id,
    avatarId: personaConfig.avatarId,
    name: personaConfig.name,
  };
}

module.exports = { isConfigured, createSessionToken, buildPersonaConfig };
