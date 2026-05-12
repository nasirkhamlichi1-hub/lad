'use strict';

// Attach a request ID to every incoming request. If the client (or upstream
// load balancer / CDN) provides X-Request-Id we trust it; otherwise we mint
// a short random one. Echoed back on the response so the client can
// reference it when reporting an issue.

const crypto = require('crypto');

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const id = (typeof incoming === 'string' && /^[\w-]{6,64}$/.test(incoming)) ? incoming : genId();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;
