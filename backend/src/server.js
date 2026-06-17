'use strict';

require('dotenv').config();

// ─── Validate env BEFORE any other imports that read it ────────────────
// validateEnv throws in production if critical vars are missing or still
// set to their dev/example values. Better to die loudly at boot than to
// run with an insecure JWT_SECRET.
const { validateEnv } = require('./validateEnv');
try {
  validateEnv();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(e.message);
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./db');
const log = require('./logger');
const requestId = require('./middleware/requestId');

// Routes
const authRoutes = require('./routes/auth');
const coursesRoutes = require('./routes/courses');
const contentRoutes = require('./routes/content');
const faqRoutes = require('./routes/faq');
const lawyersRoutes = require('./routes/lawyers');
const firmsRoutes = require('./routes/firms');
const bookingsRoutes = require('./routes/bookings');
const statsRoutes = require('./routes/stats');
const lexRoutes = require('./routes/lex');
const skillsRoutes = require('./routes/skills');
const adminUsersRoutes = require('./routes/admin-users');
const trainerRoutes = require('./routes/trainer');
const accreditationsRoutes = require('./routes/accreditations');
const cpdRoutes = require('./routes/cpd');
const notificationsRoutes = require('./routes/notifications');

const pkg = require('../package.json');
const app = express();

// Trust the first proxy (Azure App Service, Render, Nginx, Cloudflare).
// Required for correct rate-limiting and `req.protocol`/`req.ip` behind a LB.
app.set('trust proxy', 1);

// Request ID first — every other middleware can read req.id
app.use(requestId);

// ─── Security headers ───────────────────────────────────────────────────
// CSP is enforced for the API only — the static frontend portals have their
// own (looser) CSP set by Netlify. The API never serves HTML, so a strict
// policy is fine. If you ever serve HTML from here, relax `default-src`.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // frontend on a different domain
  hsts: config.isDev ? false : { maxAge: 15552000, includeSubDomains: true, preload: false },
}));

// ─── CORS ───────────────────────────────────────────────────────────────
const allowedOrigins = (config.corsOrigin || '').split(',').map(s => s.trim()).filter(Boolean);
// Always-allowed production origins, independent of any env config — so the
// live site works even if CORS_ORIGIN(S) isn't set on the host.
const ALWAYS_ALLOW = [
  'https://legalaffairstraining.com',
  'https://www.legalaffairstraining.com',
  'https://icy-mud-07d00dc03.7.azurestaticapps.net',
  'https://nice-ocean-0a45eff10.7.azurestaticapps.net',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // mobile apps, server-to-server, curl
    if (ALWAYS_ALLOW.includes(origin) || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return cb(null, true);
    log.warn('cors_rejected', { origin });
    cb(new Error('CORS: origin ' + origin + ' not allowed'));
  },
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Request logging ────────────────────────────────────────────────────
// In dev: morgan's pretty `dev` format for terminal readability.
// In prod: JSON one-liners with method/path/status/duration/requestId.
if (config.isDev) {
  app.use(morgan('dev'));
} else {
  morgan.token('id', (req) => req.id);
  app.use(morgan(
    (tokens, req, res) => JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg: 'http',
      method: tokens.method(req, res),
      path: tokens.url(req, res),
      status: parseInt(tokens.status(req, res) || '0', 10),
      duration_ms: parseFloat(tokens['response-time'](req, res) || '0'),
      length: parseInt(tokens.res(req, res, 'content-length') || '0', 10),
      ip: req.ip,
      ua: req.headers['user-agent'],
      request_id: req.id,
    })
  ));
}

// ─── Rate limit ─────────────────────────────────────────────────────────
// Skip the UAE Pass callback (we don't want to drop legitimate redirects).
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/v1/auth/uaepass'),
});
app.use('/api/', limiter);

// ─── Health & info ──────────────────────────────────────────────────────
// `/api/v1/health` is the canonical health check — used by Docker, Render,
// Azure, and the GitHub Actions deploy-success gate. Must respond fast and
// without authentication.
app.get('/api/v1/health', (_req, res) => {
  const dbOk = db.ping();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    service: 'lad-clpd-backend',
    version: pkg.version,
    env: config.nodeEnv,
    timestamp: new Date().toISOString(),
    uptime_s: Math.round(process.uptime()),
    db: dbOk ? 'connected' : 'disconnected',
  });
});

app.get('/api/v1/version', (_req, res) => {
  res.json({ name: pkg.name, version: pkg.version, env: config.nodeEnv });
});

// API routes (all under /api/v1)
app.use('/api/v1/auth',     authRoutes);
app.use('/api/v1/courses',  coursesRoutes);
app.use('/api/v1/content',  contentRoutes);
app.use('/api/v1/faq',      faqRoutes);
app.use('/api/v1/lawyers',  lawyersRoutes);
app.use('/api/v1/firms',    firmsRoutes);
app.use('/api/v1/bookings', bookingsRoutes);
app.use('/api/v1/stats',    statsRoutes);
app.use('/api/v1/lex',      lexRoutes);
app.use('/api/v1/skills',   skillsRoutes);
app.use('/api/v1/admin/users', adminUsersRoutes);
app.use('/api/v1/trainer',  trainerRoutes);
app.use('/api/v1/accreditations', accreditationsRoutes);
app.use('/api/v1/cpd',      cpdRoutes);
app.use('/api/v1/notifications', notificationsRoutes);

// Composite /config — the frontend portals call this on boot
app.get('/api/v1/config', async (_req, res, next) => {
  try {
    const [courses, content, faq, stats] = await Promise.all([
      require('./services/store').getCourses(),
      require('./services/store').getContent(),
      require('./services/store').getFAQ(),
      require('./services/store').getAggregateStats(),
    ]);
    res.json({ version: pkg.version, generated: new Date().toISOString(), courses, content, faq, stats });
  } catch (e) { next(e); }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path, request_id: req.id });
});

// Centralised error handler — never leak stack traces in production
app.use((err, req, res, _next) => {
  log.error('request_error', {
    request_id: req.id,
    method: req.method,
    path: req.path,
    error: err.message,
    code: err.code,
    stack: config.isDev ? err.stack : undefined,
  });
  const status = err.status || 500;
  res.status(status).json({
    error: err.publicMessage || (status < 500 ? err.message : 'Internal Server Error'),
    code: err.code || undefined,
    request_id: req.id,
  });
});

// ─── Start + graceful shutdown ──────────────────────────────────────────
const port = config.port;
const server = app.listen(port, () => {
  log.info('boot', {
    port,
    env: config.nodeEnv,
    db: config.databaseUrl,
    uaepass_env: config.uaepass.env,
    cors_origins: allowedOrigins,
    version: pkg.version,
  });
});

// Allow long-lived UAE Pass redirects to complete on shutdown
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown_signal', { signal });

  // Stop accepting new connections, drain in flight
  server.close((err) => {
    if (err) log.error('http_close_error', { error: err.message });
    try { db.close && db.close(); } catch (_) { /* SQLite uses .close in better-sqlite3 */ }
    log.info('shutdown_complete');
    process.exit(err ? 1 : 0);
  });

  // Force-exit if drain takes too long (Render/K8s send SIGKILL after 30s anyway)
  setTimeout(() => {
    log.error('shutdown_forced_after_timeout');
    process.exit(1);
  }, 25000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log.error('unhandled_rejection', { reason: reason && reason.stack ? reason.stack : String(reason) });
});
process.on('uncaughtException', (err) => {
  log.error('uncaught_exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
