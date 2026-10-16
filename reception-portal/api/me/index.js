// Returns the signed-in user's identity, role and assigned courses (for the
// unified portal to resume a session without re-login).
const S = require('../_shared');
module.exports = async function (context, req) {
  const token = (req.query && req.query.token) || (req.body && req.body.token) || '';
  const email = S.verify(token);
  if (!email) return S.json(context, 401, { error: 'Please sign in again.' });
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  const user = await S.getUser(c, email);
  let name = (user && user.name) || '';
  try { const e = await c.getEntity(S.P_PROGRESS, email); if (e.name) name = e.name; } catch (_) {}
  return S.json(context, 200, { email, name, role: S.userRole(email, user), courses: S.userCourses(user), super: S.isSuper(email) });
};
