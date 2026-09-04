// Admin console API for the unified portal: list users and set role / assigned
// courses / enrolment. Gated by ADMIN_PASSWORD or a super-admin session token.
const S = require('../_shared');
module.exports = async function (context, req) {
  if (!S.adminOk(req)) return S.json(context, 401, { error: 'Administrator access required.' });
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }

  if (req.method === 'GET') {
    const users = [];
    try {
      const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${S.P_USERS}'` } });
      for await (const e of ents) {
        const email = e.email || e.rowKey;
        users.push({ email, name: e.name || '', role: S.userRole(email, e), courses: S.userCourses(e), active: e.active !== false, isSuper: !!e.isSuper });
      }
    } catch (e) { context.log.error('user list', e && e.message); return S.json(context, 500, { error: 'Could not list users.' }); }
    users.sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
    return S.json(context, 200, { count: users.length, users, roles: S.ROLES });
  }

  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return S.json(context, 400, { error: 'A valid email is required.' });
  const patch = { partitionKey: S.P_USERS, rowKey: email, email };
  if (typeof b.role === 'string') { if (S.ROLES.indexOf(b.role) < 0) return S.json(context, 400, { error: 'Invalid role.' }); patch.role = b.role; }
  if (Array.isArray(b.courses)) patch.courses = JSON.stringify(b.courses.map(x => String(x).slice(0, 60)).slice(0, 50));
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
  try { await c.upsertEntity(patch, 'Merge'); } catch (e) { context.log.error('user update', e && e.message); return S.json(context, 500, { error: 'Could not update the user.' }); }
  const user = await S.getUser(c, email);
  return S.json(context, 200, { ok: true, email, name: (user && user.name) || '', role: S.userRole(email, user), courses: S.userCourses(user), active: user && user.active !== false });
};
