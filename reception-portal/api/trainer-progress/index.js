// Per-user learning record for the AI Trainer. One row per user (partition
// 'trainer', rowKey = email) holding a JSON map of lesson -> result. Scales to
// thousands of users cheaply on Azure Table Storage.
//   GET  ?token=...           -> { progress }
//   POST { token, result }    -> save a finished session, returns { progress }
const S = require('../_shared');
const P_TRAINER = 'trainer';

async function loadProg(c, email) {
  try { const e = await c.getEntity(P_TRAINER, email); return { progress: JSON.parse(e.progress || '{}'), name: e.name || '' }; }
  catch (_) { return { progress: {}, name: '' }; }
}

module.exports = async function (context, req) {
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }

  if (req.method === 'GET') {
    const email = S.verify((req.query && req.query.token) || '');
    if (!email) return S.json(context, 401, { error: 'Please sign in again.' });
    const p = await loadProg(c, email);
    return S.json(context, 200, { progress: p.progress });
  }

  const b = req.body || {};
  const email = S.verify(b.token || '');
  if (!email) return S.json(context, 401, { error: 'Please sign in again.' });
  const r = b.result || {};
  const lessonId = String(r.lessonId || '').slice(0, 80);
  if (!lessonId) return S.json(context, 400, { error: 'lessonId required' });
  const courseId = String(r.courseId || 'general').slice(0, 60);
  const key = courseId + '::' + lessonId;
  const eng = Math.max(0, Math.min(100, parseInt(r.engagementScore, 10) || 0));
  const passed = !!r.pass && eng >= 50;

  const cur = await loadProg(c, email);
  const prog = cur.progress;
  const prev = prog[key] || { attempts: 0, bestEngagement: 0, cpd: 0, pass: false };

  // Mid-session save: keep a resume blob so the learner continues, not restarts.
  // Does NOT count as an attempt or change pass/score.
  if (r.resume && r.completed === false) {
    const rz = r.resume || {};
    const history = Array.isArray(rz.history) ? rz.history.slice(-60).map(h => ({
      role: (h && h.role === 'trainer') ? 'trainer' : 'lawyer',
      text: String((h && h.text) || '').slice(0, 4000)
    })).filter(h => h.text) : [];
    prog[key] = Object.assign({}, prev, {
      title: String(r.lessonTitle || prev.title || '').slice(0, 140), courseId, lessonId,
      resume: { history, covered: parseInt(rz.covered, 10) || 0, total: parseInt(rz.total, 10) || 0,
        elapsedSec: parseInt(rz.elapsedSec, 10) || 0, secIndex: parseInt(rz.secIndex, 10) || 0 },
      savedAt: new Date().toISOString()
    });
    try {
      await c.upsertEntity({ partitionKey: P_TRAINER, rowKey: email, email, name: cur.name || String(b.name || '').slice(0, 80),
        progress: JSON.stringify(prog), completedCount: Object.values(prog).filter(x => x && x.completed).length,
        cpdTotal: Object.values(prog).reduce((a, x) => a + ((x && x.cpd) || 0), 0), updated: new Date().toISOString() }, 'Replace');
    } catch (e) { context.log.error('save resume failed', e && e.message); return S.json(context, 500, { error: 'Could not save your progress.' }); }
    return S.json(context, 200, { ok: true, saved: true, progress: prog });
  }
  const cpd = (passed && !prev.pass) ? (parseInt(r.cpd, 10) || 1) : (prev.cpd || 0);
  prog[key] = {
    title: String(r.lessonTitle || prev.title || '').slice(0, 140),
    courseId, lessonId,
    attempts: (prev.attempts || 0) + 1,
    lastEngagement: eng,
    bestEngagement: Math.max(prev.bestEngagement || 0, eng),
    covered: parseInt(r.covered, 10) || 0,
    total: parseInt(r.total, 10) || 0,
    completed: (r.completed !== false) || !!prev.completed,
    pass: passed || !!prev.pass,
    cpd,
    durationSec: parseInt(r.durationSec, 10) || prev.durationSec || 0,
    lastAt: new Date().toISOString()
  };
  const completedCount = Object.values(prog).filter(x => x && x.completed).length;
  const cpdTotal = Object.values(prog).reduce((a, x) => a + ((x && x.cpd) || 0), 0);
  try {
    await c.upsertEntity({ partitionKey: P_TRAINER, rowKey: email, email, name: cur.name || String(b.name || '').slice(0, 80), progress: JSON.stringify(prog), completedCount, cpdTotal, updated: new Date().toISOString() }, 'Replace');
  } catch (e) { context.log.error('save result failed', e && e.message); return S.json(context, 500, { error: 'Could not save your result.' }); }
  return S.json(context, 200, { ok: true, progress: prog });
};
