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
  corsOrigin: process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || 'http://localhost:8080',
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
    model:  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  },

  // ─── Anam (photoreal avatar — face + voice) ──────────────────────────
  // Anam renders the photoreal face AND speaks; Claude (anthropic above) is the
  // brain and the browser does perception. Keys stay server-side; the browser
  // only ever sees a short-lived session token. If ANAM_API_KEY is unset, the
  // trainer falls back to an animated avatar with the browser voice.
  anam: {
    apiKey:   process.env.ANAM_API_KEY || '',
    baseUrl:  process.env.ANAM_BASE_URL || 'https://api.anam.ai',
    // Defaults to "Gabriel" (a stock Anam avatar, cara-4-latest) so a deploy
    // only needs ANAM_API_KEY set; override ANAM_AVATAR_ID to pick another.
    avatarId: process.env.ANAM_AVATAR_ID || '6cc28442-cccd-42a8-b6e4-24b7210a09c5',
    voiceId:  process.env.ANAM_VOICE_ID || '',            // optional specific Anam voice
    name:     process.env.ANAM_AVATAR_NAME || 'CLPD Trainer',
  },

  // MorphCast Emotion AI — optional in-browser perception ("eyes") provider.
  // The licence key is a CLIENT-side key (used by the browser SDK), so it is
  // surfaced to the frontend via /trainer/status. If unset, the browser engine
  // uses the free TensorFlow.js model. No frames ever leave the device.
  morphcast: {
    licenseKey: process.env.MORPHCAST_LICENSE_KEY || '',
  },

  // Claude as the trainer brain (scalable engine). Reuses anthropic.apiKey.
  trainerBrain: {
    model:     process.env.TRAINER_BRAIN_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    maxTokens: parseInt(process.env.TRAINER_BRAIN_MAX_TOKENS || '500', 10),
  },

  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax:      parseInt(process.env.RATE_LIMIT_MAX || '120', 10),

  // Transactional email (SMTP relay). When host is unset the email service
  // queues mail in email_outbox but never transmits — see services/email.js.
  mail: {
    host:     process.env.SMTP_HOST || '',
    port:     parseInt(process.env.SMTP_PORT || '587', 10),
    secure:   String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user:     process.env.SMTP_USER || '',
    from:     process.env.MAIL_FROM || '',
    fromName: process.env.MAIL_FROM_NAME || 'LAD CLPD',
    configured: !!(process.env.SMTP_HOST || '').trim(),
  },
};
