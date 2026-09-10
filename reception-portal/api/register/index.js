// Self-service trainee registration. Scales to thousands: one row per user in
// the existing Azure Table (partition 'users'). If an ENROLMENT_CODE app setting
// is present, it is required (so the LAD can control who signs up); otherwise
// registration is open to any valid email.
const S = require('../_shared');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = async function (context, req) {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const name = String(b.name || '').trim().slice(0, 80);
  const code = String(b.code || '');
  if (!EMAIL_RE.test(email)) return S.json(context, 400, { error: 'Please enter a valid email address.' });
  if (password.length < 8) return S.json(context, 400, { error: 'Password must be at least 8 characters.' });
  const required = process.env.ENROLMENT_CODE || '';
  if (required && code !== required) return S.json(context, 403, { error: 'That enrolment code is not valid. Ask your training administrator.' });

  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'Could not reach the training server. Try again shortly.' }); }
  const existing = await S.getUser(c, email);
  if (existing && existing.pass) return S.json(context, 409, { error: 'An account with this email already exists — please sign in.' });
  try {
    await c.upsertEntity({ partitionKey: S.P_USERS, rowKey: email, email, name, pass: S.hashPw(password), active: true, createdAt: new Date().toISOString() }, 'Merge');
  } catch (e) { context.log.error('register failed', e && e.message); return S.json(context, 500, { error: 'Could not create your account.' }); }
  return S.json(context, 200, { ok: true, token: S.sign(email), email, name });
};
