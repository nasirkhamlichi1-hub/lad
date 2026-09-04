// Admin overview of all trainees' learning records. Gated by ADMIN_PASSWORD
// (x-admin-pass header, ?pass=, or body.adminPass), matching the academy admin.
const S = require('../_shared');
const P_TRAINER = 'trainer';

module.exports = async function (context, req) {
  if (!S.adminOk(req)) return S.json(context, 401, { error: 'Administrator access required.' });
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  const learners = [];
  try {
    const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P_TRAINER}'` } });
    for await (const e of ents) {
      let prog = {}; try { prog = JSON.parse(e.progress || '{}'); } catch (_) {}
      learners.push({
        email: e.email, name: e.name || '',
        completedCount: e.completedCount || 0, cpdTotal: e.cpdTotal || 0, updated: e.updated || '',
        lessons: Object.values(prog).map(x => ({ title: x.title, courseId: x.courseId, bestEngagement: x.bestEngagement || 0, pass: !!x.pass, attempts: x.attempts || 0, lastAt: x.lastAt }))
      });
    }
  } catch (e) { context.log.error('admin list failed', e && e.message); return S.json(context, 500, { error: 'Could not list learners.' }); }
  learners.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  return S.json(context, 200, { count: learners.length, learners });
};
