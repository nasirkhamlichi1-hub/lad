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

  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax:      parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
};
