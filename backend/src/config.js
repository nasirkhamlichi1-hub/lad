'use strict';

// Loads .env and exposes a single config object. UAE Pass endpoints are
// derived from `UAEPASS_ENV` so you can switch between staging and production
// by changing a single variable.

const UAEPASS_ENDPOINTS = {
  staging: {
    base:      'https://stg-id.uaepass.ae',
    authorize: 'https://stg-id.uaepass.ae/idshub/authorize',
    token:     'https://stg-id.uaepass.ae/idshub/token',
    userinfo:  'https://stg-id.uaepass.ae/idshub/userinfo',
    logout:    'https://stg-id.uaepass.ae/idshub/logout',
  },
  production: {
    base:      'https://id.uaepass.ae',
    authorize: 'https://id.uaepass.ae/idshub/authorize',
    token:     'https://id.uaepass.ae/idshub/token',
    userinfo:  'https://id.uaepass.ae/idshub/userinfo',
    logout:    'https://id.uaepass.ae/idshub/logout',
  },
};

const env = (process.env.UAEPASS_ENV || 'staging').toLowerCase();
if (!UAEPASS_ENDPOINTS[env]) {
  throw new Error(`UAEPASS_ENV must be 'staging' or 'production'; got '${env}'`);
}

const isProd = env === 'production';
const clientId     = isProd ? process.env.UAEPASS_CLIENT_ID_PROD     : process.env.UAEPASS_CLIENT_ID;
const clientSecret = isProd ? process.env.UAEPASS_CLIENT_SECRET_PROD : process.env.UAEPASS_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  // Warning, not fatal — the rest of the API still works without UAE Pass.
  // eslint-disable-next-line no-console
  console.warn(`[config] UAE Pass credentials missing for env='${env}'. /auth/uaepass/* routes will return 503.`);
}

module.exports = {
  nodeEnv:  process.env.NODE_ENV || 'development',
  isDev:    (process.env.NODE_ENV || 'development') === 'development',
  port:     parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  publicApiBase: process.env.PUBLIC_API_BASE || 'http://localhost:4000',

  databaseUrl: process.env.DATABASE_URL || './data/lad-clpd.sqlite',

  jwt: {
    secret:    process.env.JWT_SECRET || 'dev-only-do-not-use-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  uaepass: {
    env,
    endpoints:    UAEPASS_ENDPOINTS[env],
    clientId,
    clientSecret,
    redirectUri:  process.env.UAEPASS_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/uaepass/callback',
    postLoginUrl: process.env.FRONTEND_POST_LOGIN_URL || 'http://localhost:8080/router.html',
    scope:        process.env.UAEPASS_SCOPE || 'urn:uae:digitalid:profile:general',
    acr:          process.env.UAEPASS_ACR || 'urn:safelayer:tws:policies:authentication:level:low',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model:  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  },

  // ─── AI Trainer (Tavus Conversational Video Interface) ───────────────
  // The realistic avatar trainer. Tavus drives the photoreal face + the
  // Raven perception model (sees the attendee's camera). ElevenLabs is the
  // voice. All keys stay server-side — the frontend never sees them.
  // If TAVUS_API_KEY + TAVUS_REPLICA_ID are unset, /trainer/* runs in demo
  // mode (no live conversation; the frontend shows a simulated experience).
  tavus: {
    apiKey:           process.env.TAVUS_API_KEY || '',
    baseUrl:          process.env.TAVUS_BASE_URL || 'https://tavusapi.com',
    replicaId:        process.env.TAVUS_REPLICA_ID || '',
    personaId:        process.env.TAVUS_PERSONA_ID || '',
    perceptionModel:  process.env.TAVUS_PERCEPTION_MODEL || 'raven-1',
    maxCallDurationS: parseInt(process.env.TAVUS_MAX_CALL_DURATION_S || '1800', 10),
    enableRecording:  (process.env.TAVUS_ENABLE_RECORDING || 'false') === 'true',
  },

  elevenlabs: {
    apiKey:  process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || '',
    model:   process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5',
  },

  // ─── Anam (photoreal avatar, scalable "browser" engine) ──────────────
  // The cheap-to-scale alternative to Tavus: Anam renders the photoreal face,
  // Claude (anthropic above) is the brain, ElevenLabs is the voice, and the
  // browser does perception. Keys stay server-side; the browser only ever sees
  // a short-lived session token. If ANAM_API_KEY is unset, the browser engine
  // falls back to a stylised avatar so it still runs.
  anam: {
    apiKey:   process.env.ANAM_API_KEY || '',
    baseUrl:  process.env.ANAM_BASE_URL || 'https://api.anam.ai',
    avatarId: process.env.ANAM_AVATAR_ID || '',           // a photoreal persona/avatar id
    name:     process.env.ANAM_AVATAR_NAME || 'CLPD Trainer',
  },

  // Claude as the trainer brain (scalable engine). Reuses anthropic.apiKey.
  trainerBrain: {
    model:     process.env.TRAINER_BRAIN_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.TRAINER_BRAIN_MAX_TOKENS || '500', 10),
  },

  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax:      parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
};
