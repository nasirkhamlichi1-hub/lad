// Live session presence for the AI Trainer. While an attendee is in a session
// their browser posts a lightweight heartbeat (a few times a minute). Admins can
// then see, in real time, how far along any attendee is in any given session.
//   POST { token, live:{...} }  -> record this attendee's live position
//   GET  ?pass=/token=  (admin) -> active attendees (heartbeat within ACTIVE_MS)
const S = require('../_shared');
const P_LIVE = 'live';
const ACTIVE_MS = 75 * 1000; // treat an attendee as live if seen in the last 75s

module.exports = async function (context, req) {
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }

  // ---- admin: list who is live right now ----
  if (req.method === 'GET') {
    if (!S.adminOk(req)) return S.json(context, 401, { error: 'Administrator access required.' });
    const now = Date.now();
    const live = [];
    try {
      const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P_LIVE}'` } });
      for await (const e of ents) {
        const seen = e.updatedAt ? Date.parse(e.updatedAt) : 0;
        if (!seen || (now - seen) > ACTIVE_MS) continue; // stale → not live
        live.push({
          email: e.email, name: e.name || '',
          courseId: e.courseId || '', sectionId: e.sectionId || '', sectionTitle: e.sectionTitle || '',
          sectionIndex: e.sectionIndex || 0, sectionTotal: e.sectionTotal || 0,
          objDone: e.objDone || 0, objTotal: e.objTotal || 0,
          elapsedSec: e.elapsedSec || 0, targetMin: e.targetMin || 0,
          engagement: (e.engagement == null ? null : e.engagement), mode: e.mode || 'lesson',
          updatedAt: e.updatedAt || '', secondsAgo: Math.round((now - seen) / 1000)
        });
      }
    } catch (e) { context.log.error('live list failed', e && e.message); return S.json(context, 500, { error: 'Could not list live sessions.' }); }
    live.sort((a, b) => (a.secondsAgo - b.secondsAgo));
    return S.json(context, 200, { count: live.length, live });
  }

  // ---- attendee heartbeat ----
  const b = req.body || {};
  const email = S.verify(b.token || '');
  if (!email) return S.json(context, 401, { error: 'Please sign in again.' });
  const L = b.live || {};
  const num = (v, max) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));

  // A session marked ended just clears presence so it drops off the live list.
  if (L.ended) {
    try { await c.deleteEntity(P_LIVE, email); } catch (_) {}
    return S.json(context, 200, { ok: true, ended: true });
  }

  try {
    await c.upsertEntity({
      partitionKey: P_LIVE, rowKey: email, email,
      name: String(b.name || L.name || '').slice(0, 80),
      courseId: String(L.courseId || '').slice(0, 60),
      sectionId: String(L.sectionId || '').slice(0, 80),
      sectionTitle: String(L.sectionTitle || '').slice(0, 160),
      sectionIndex: num(L.sectionIndex, 999), sectionTotal: num(L.sectionTotal, 999),
      objDone: num(L.objDone, 999), objTotal: num(L.objTotal, 999),
      elapsedSec: num(L.elapsedSec, 1000000), targetMin: num(L.targetMin, 1000),
      engagement: num(L.engagement, 100), mode: String(L.mode || 'lesson').slice(0, 20),
      updatedAt: new Date().toISOString()
    }, 'Replace');
  } catch (e) { context.log.error('live heartbeat failed', e && e.message); return S.json(context, 500, { error: 'heartbeat failed' }); }
  return S.json(context, 200, { ok: true });
};
