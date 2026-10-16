const S = require('../_shared');

module.exports = async function (context, req) {
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  if (req.method === 'GET') {
    const email = S.verify((req.query && req.query.token) || '');
    if (!email) return S.json(context, 401, { error: 'Please sign in again.' });
    let progress = {}; try { const e = await c.getEntity(S.P_PROGRESS, email); progress = JSON.parse(e.progress || '{}'); } catch (_) {}
    return S.json(context, 200, { progress });
  }
  const b = req.body || {};
  const email = S.verify(b.token || '');
  if (!email) return S.json(context, 401, { error: 'Please sign in again.' });
  const progress = b.progress || {};
  const name = String(b.name || '').slice(0, 80);
  try { await c.upsertEntity({ partitionKey: S.P_PROGRESS, rowKey: email, email, name, progress: JSON.stringify(progress), certified: S.certifiedCount(progress), updated: new Date().toISOString() }, 'Replace'); }
  catch (e) { return S.json(context, 500, { error: 'Could not save.' }); }
  return S.json(context, 200, { ok: true });
};
