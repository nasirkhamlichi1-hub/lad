'use strict';

// Minimal structured logger. JSON lines in production (parseable by every
// log aggregator), pretty single-line in development. Avoids pulling in
// pino/winston to keep dependencies tight.

const config = require('./config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function emit(level, msg, meta) {
  if (LEVELS[level] < minLevel) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: typeof msg === 'string' ? msg : JSON.stringify(msg),
    ...(meta || {}),
  };
  if (config.isDev) {
    const tag = level === 'error' ? '✗' : level === 'warn' ? '!' : '·';
    const ctx = meta ? ' ' + Object.entries(meta).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ') : '';
    // eslint-disable-next-line no-console
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(`${record.ts} ${tag} ${record.msg}${ctx}`);
  } else {
    // eslint-disable-next-line no-console
    (level === 'error' ? console.error : console.log)(JSON.stringify(record));
  }
}

module.exports = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info:  (msg, meta) => emit('info',  msg, meta),
  warn:  (msg, meta) => emit('warn',  msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};
