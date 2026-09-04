const S = require('../_shared');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = async function (context, req) {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!email || !EMAIL_RE.test(email)) return S.json(context, 400, { error: 'Please enter a valid email address.' });
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'Could not reach the training server. Try again shortly.' }); }
  const user = await S.getUser(c, email);
  const enrolled = (user && user.active !== false) || S.envAllowed(email);
  if (!enrolled) return S.json(context, 403, { error: 'This email is not enrolled. Ask your training administrator to add you.' });
  let good = false;
  if (user && user.pass) good = S.checkPw(password, user.pass);
  else { const cfg = await S.getConfig(c); if (cfg && cfg.sharedHash) good = S.checkPw(password, cfg.sharedHash); else good = !!process.env.TRAINEE_PASSWORD && password === process.env.TRAINEE_PASSWORD; }
  if (!good) return S.json(context, 401, { error: 'That password is not correct.' });
  let progress = {}, name = (user && user.name) || '';
  try { const e = await c.getEntity(S.P_PROGRESS, email); progress = JSON.parse(e.progress || '{}'); if (e.name) name = e.name; } catch (_) {}
  return S.json(context, 200, { ok: true, token: S.sign(email), email, name, progress });
};
