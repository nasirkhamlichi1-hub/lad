// Lists AI-built courses for the trainer (GET, token-gated) and lets an admin
// delete one (POST {delete:courseId}, ADMIN_PASSWORD-gated).
const S = require('../_shared');
const P_COURSES = 'courses';

module.exports = async function (context, req) {
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }

  if (req.method === 'POST') {
    if (!S.adminOk(req)) return S.json(context, 401, { error: 'Administrator access required.' });
    const id = String((req.body && req.body.delete) || '').trim();
    if (!id) return S.json(context, 400, { error: 'delete id required' });
    try { await c.deleteEntity(P_COURSES, id); } catch (e) {}
    return S.json(context, 200, { ok: true });
  }

  if (!S.verify((req.query && req.query.token) || '') && !S.adminOk(req)) return S.json(context, 401, { error: 'Please sign in again.' });
  const courses = [];
  try {
    const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P_COURSES}'` } });
    for await (const e of ents) {
      let lessons = []; try { lessons = JSON.parse(e.lessons || '[]'); } catch (_) {}
      courses.push({ courseId: e.courseId, title: e.title, lessons });
    }
  } catch (e) { context.log.error('list courses', e && e.message); return S.json(context, 500, { error: 'Could not list courses.' }); }
  return S.json(context, 200, { courses });
};
