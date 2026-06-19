'use strict';

// Validates environment variables on boot. In production, refuses to start
// when critical secrets are missing or still set to dev/example values.
// Run this from server.js BEFORE binding the port.

const REQUIRED_IN_PROD = [
  'JWT_SECRET',
  'CORS_ORIGIN',
  'DATABASE_URL',
];

// Values that must NEVER appear in production. These are the dev defaults
// shipped in .env.example — if any of them survive into prod, fail fast.
const FORBIDDEN_PROD_VALUES = {
  JWT_SECRET: [
    'replace-me-with-48-random-bytes',
    'dev-only-do-not-use-in-production',
    'changeme',
    'secret',
    '',
  ],
  UAEPASS_CLIENT_ID: ['sandbox_web_stage'],
  UAEPASS_CLIENT_SECRET: ['sandbox_secret'],
};

class EnvError extends Error {
  constructor(messages) {
    super('Environment configuration error:\n  - ' + messages.join('\n  - '));
    this.name = 'EnvError';
    this.messages = messages;
  }
}

function isProduction() {
  return (process.env.NODE_ENV || 'development').toLowerCase() === 'production';
}

function validateEnv() {
  const errors = [];
  const warnings = [];
  const env = process.env;

  // JWT secret must be long enough to be cryptographically meaningful
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
    warnings.push(`JWT_SECRET is only ${env.JWT_SECRET.length} chars — use at least 32 (48+ recommended). Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
  }

  if (isProduction()) {
    // Required vars must be present
    for (const key of REQUIRED_IN_PROD) {
      if (!env[key]) errors.push(`${key} is required in production but not set`);
    }

    // Forbidden default values
    for (const [key, badValues] of Object.entries(FORBIDDEN_PROD_VALUES)) {
      if (env[key] && badValues.includes(env[key])) {
        errors.push(`${key} is set to the development/example value "${env[key]}" — generate a real value before deploying`);
      }
    }

    // UAE Pass: if env is production, require production credentials
    if ((env.UAEPASS_ENV || '').toLowerCase() === 'production') {
      if (!env.UAEPASS_CLIENT_ID_PROD) errors.push('UAEPASS_ENV=production but UAEPASS_CLIENT_ID_PROD is empty');
      if (!env.UAEPASS_CLIENT_SECRET_PROD) errors.push('UAEPASS_ENV=production but UAEPASS_CLIENT_SECRET_PROD is empty');
      if (env.UAEPASS_REDIRECT_URI && !env.UAEPASS_REDIRECT_URI.startsWith('https://')) {
        errors.push('UAEPASS_REDIRECT_URI must use https:// in production');
      }
    } else if ((env.UAEPASS_ENV || '').toLowerCase() === 'staging') {
      warnings.push('NODE_ENV=production but UAEPASS_ENV=staging — confirm this is intentional');
    }

    // CORS origin should be HTTPS only in prod
    if (env.CORS_ORIGIN) {
      const origins = env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
      const insecure = origins.filter(o => o !== '*' && !o.startsWith('https://') && !o.startsWith('http://localhost'));
      if (insecure.length) errors.push(`CORS_ORIGIN contains non-HTTPS origins in production: ${insecure.join(', ')}`);
      if (origins.includes('*')) errors.push('CORS_ORIGIN=* is unsafe in production — list explicit frontend origins');
    }

    // Database in production must be Postgres-style URL or absolute path
    if (env.DATABASE_URL && env.DATABASE_URL.startsWith('./')) {
      warnings.push(`DATABASE_URL is a relative path (${env.DATABASE_URL}) — fine if running from a fixed working dir behind a persistent volume; risky otherwise`);
    }

    // Anthropic key — warn only (Lex AI is optional)
    if (!env.ANTHROPIC_API_KEY) {
      warnings.push('ANTHROPIC_API_KEY is not set — the Lex AI panel will return 503 to clients');
    }

    // SMTP relay — warn only (mail queues in email_outbox until configured)
    if (!env.SMTP_HOST) {
      warnings.push('SMTP_HOST is not set — transactional emails (bookings, receipts, accreditation decisions) will queue in email_outbox but not send. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM to enable.');
    } else if (!env.MAIL_FROM && !env.SMTP_USER) {
      warnings.push('SMTP_HOST is set but neither MAIL_FROM nor SMTP_USER is — outgoing mail has no From address.');
    }
  }

  // Always print warnings
  for (const w of warnings) console.warn('[env]  WARN:', w);

  if (errors.length) {
    if (isProduction()) {
      throw new EnvError(errors);
    } else {
      for (const e of errors) console.warn('[env]  ERROR (would fail in prod):', e);
    }
  } else {
    console.log(`[env]  ✓ environment validated (${isProduction() ? 'production' : 'development'})`);
  }
}

module.exports = { validateEnv, EnvError };
