const S = require('../_shared');

module.exports = async function (context, req) {
  const email = S.verify((req.query && req.query.t) || '');
  if (!email) return S.json(context, 401, { error: 'This certificate link is not valid.' });
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  let progress = {}, name = '', updated = '';
  try { const e = await c.getEntity(S.P_PROGRESS, email); progress = JSON.parse(e.progress || '{}'); name = e.name || ''; updated = e.updated || ''; } catch (_) {}
  if (!name) { const u = await S.getUser(c, email); if (u) name = u.name || ''; }
  const count = S.certifiedCount(progress);
  return S.json(context, 200, { email, name, certified: count, completed: count >= 11, date: updated || new Date().toISOString() });
};
