const { client, ensureTable, json, sign, checkPw, getUser, getConfig, envAllowed, P_PROGRESS } = require('../_shared');

module.exports = async function (context, req) {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(context, 400, { error: 'Please enter a valid email address.' });
  }
  let c;
  try { c = client(); await ensureTable(c); }
  catch (e) { return json(context, 500, { error: 'Could not reach the training server. Try again shortly.' }); }

  // must be enrolled (in the users table) or whitelisted via ALLOWED_EMAILS
  const user = await getUser(c, email);
  const enrolled = (user && user.active !== false) || envAllowed(email);
  if (!enrolled) return json(context, 403, { error: 'This email is not enrolled. Ask your training administrator to add you.' });

  // password: per-user password if set, otherwise the shared password (config row, then env)
  let ok = false;
  if (user && user.pass) {
    ok = checkPw(password, user.pass);
  } else {
    const cfg = await getConfig(c);
    if (cfg && cfg.sharedHash) ok = checkPw(password, cfg.sharedHash);
    else ok = !!process.env.TRAINEE_PASSWORD && password === process.env.TRAINEE_PASSWORD;
  }
  if (!ok) return json(context, 401, { error: 'That password is not correct.' });

  let progress = {}, name = (user && user.name) || '';
  try { const e = await c.getEntity(P_PROGRESS, email); progress = JSON.parse(e.progress || '{}'); if (e.name) name = e.name; }
  catch (notFound) {}

  return json(context, 200, { ok: true, token: sign(email), email, name, progress });
};
