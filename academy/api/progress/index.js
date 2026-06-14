const { client, ensureTable, verify, certifiedCount, PARTITION } = require('../_shared');

function json(context, status, body) {
  context.res = { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body };
}

module.exports = async function (context, req) {
  let c;
  try { c = client(); await ensureTable(c); }
  catch (e) { return json(context, 500, { error: 'store unavailable' }); }

  if (req.method === 'GET') {
    const email = verify(req.query.token || '');
    if (!email) return json(context, 401, { error: 'Please sign in again.' });
    let progress = {};
    try { const e = await c.getEntity(PARTITION, email); progress = JSON.parse(e.progress || '{}'); }
    catch (notFound) { /* none yet */ }
    return json(context, 200, { progress });
  }

  // POST — save progress for the signed-in user
  const token = (req.body && req.body.token) || '';
  const email = verify(token);
  if (!email) return json(context, 401, { error: 'Please sign in again.' });
  const progress = (req.body && req.body.progress) || {};
  const name = String((req.body && req.body.name) || '').slice(0, 80);
  try {
    await c.upsertEntity({
      partitionKey: PARTITION,
      rowKey: email,
      email,
      name,
      progress: JSON.stringify(progress),
      certified: certifiedCount(progress),
      updated: new Date().toISOString()
    }, 'Replace');
  } catch (e) {
    context.log.error('progress save error', e && e.message);
    return json(context, 500, { error: 'Could not save. Your progress is kept on this device meanwhile.' });
  }
  return json(context, 200, { ok: true });
};
