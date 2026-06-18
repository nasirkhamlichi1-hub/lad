const S = require('../_shared');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = async function (context, req) {
  const b = req.body || {};
  const pass = (req.headers && req.headers['x-admin-pass']) || (req.query && req.query.pass) || b.adminPass || '';
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  const cfgAuth = await S.getConfig(c);
  const envPass = process.env.ADMIN_PASSWORD || '';
  if (!envPass && !(cfgAuth && cfgAuth.adminHash)) return S.json(context, 500, { error: 'Admin is not configured (set ADMIN_PASSWORD).' });
  const passOk = (cfgAuth && cfgAuth.adminHash && S.checkPw(pass, cfgAuth.adminHash)) || (envPass && pass === envPass);
  if (!passOk) return S.json(context, 401, { error: 'Wrong admin password.' });

  if (req.method === 'GET') {
    const prog = {};
    for await (const e of c.listEntities({ queryOptions: { filter: `PartitionKey eq '${S.P_PROGRESS}'` } })) {
      let p = {}; try { p = JSON.parse(e.progress || '{}'); } catch (_) {}
      prog[(e.email || e.rowKey).toLowerCase()] = { progress: p, name: e.name || '', certified: e.certified || S.certifiedCount(p), updated: e.updated || '' };
    }
    const users = [], seen = new Set();
    for await (const u of c.listEntities({ queryOptions: { filter: `PartitionKey eq '${S.P_USERS}'` } })) {
      const em = (u.email || u.rowKey).toLowerCase(); seen.add(em); const pr = prog[em] || {};
      users.push({ email: em, name: u.name || pr.name || '', active: u.active !== false, hasOwnPassword: !!u.pass, certified: pr.certified || 0, updated: pr.updated || '', progress: pr.progress || {} });
    }
    Object.keys(prog).forEach(em => { if (!seen.has(em)) { const pr = prog[em]; users.push({ email: em, name: pr.name || '', active: true, hasOwnPassword: false, certified: pr.certified || 0, updated: pr.updated || '', progress: pr.progress || {} }); } });
    users.sort((a, b2) => String(b2.updated).localeCompare(String(a.updated)));
    return S.json(context, 200, { users, sharedPasswordSet: !!(cfgAuth && cfgAuth.sharedHash) || !!process.env.TRAINEE_PASSWORD, emailConfigured: false });
  }

  const action = b.action || '';
  const email = String(b.email || '').trim().toLowerCase();
  try {
    if (action === 'addUser' || action === 'addUsers') {
      const items = action === 'addUsers'
        ? String(b.emails || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
        : [email];
      const added = [], skipped = [];
      for (const em of items) {
        if (!EMAIL_RE.test(em)) { skipped.push(em); continue; }
        await c.upsertEntity({ partitionKey: S.P_USERS, rowKey: em, email: em, name: (action === 'addUser' ? (b.name || '') : ''), active: true, created: new Date().toISOString() }, 'Merge');
        added.push(em);
      }
      return S.json(context, 200, { ok: true, added, skipped });
    }
    if (action === 'removeUser') {
      if (!EMAIL_RE.test(email)) return S.json(context, 400, { error: 'Invalid email.' });
      try { await c.deleteEntity(S.P_USERS, email); } catch (_) {}
      if (b.alsoProgress) { try { await c.deleteEntity(S.P_PROGRESS, email); } catch (_) {} }
      return S.json(context, 200, { ok: true });
    }
    if (action === 'setActive') {
      if (!EMAIL_RE.test(email)) return S.json(context, 400, { error: 'Invalid email.' });
      await c.upsertEntity({ partitionKey: S.P_USERS, rowKey: email, active: !!b.active }, 'Merge');
      return S.json(context, 200, { ok: true });
    }
    if (action === 'setUserPassword') {
      if (!EMAIL_RE.test(email)) return S.json(context, 400, { error: 'Invalid email.' });
      const pw = String(b.password || '');
      await c.upsertEntity({ partitionKey: S.P_USERS, rowKey: email, pass: pw ? S.hashPw(pw) : '' }, 'Merge');
      return S.json(context, 200, { ok: true });
    }
    if (action === 'setSharedPassword') {
      const pw = String(b.password || '');
      if (pw.length < 4) return S.json(context, 400, { error: 'Choose a password of at least 4 characters.' });
      await c.upsertEntity({ partitionKey: S.P_CONFIG, rowKey: 'settings', sharedHash: S.hashPw(pw), updated: new Date().toISOString() }, 'Merge');
      return S.json(context, 200, { ok: true });
    }
    if (action === 'setAdminPassword') {
      const pw = String(b.password || '');
      if (pw.length < 4) return S.json(context, 400, { error: 'Choose a password of at least 4 characters.' });
      await c.upsertEntity({ partitionKey: S.P_CONFIG, rowKey: 'settings', adminHash: S.hashPw(pw), updated: new Date().toISOString() }, 'Merge');
      return S.json(context, 200, { ok: true });
    }
    return S.json(context, 400, { error: 'Unknown action.' });
  } catch (e) {
    try { context.log.error('admin action error', action, e && e.message); } catch (_) {}
    return S.json(context, 500, { error: 'Action failed: ' + ((e && e.message) || 'error') });
  }
};
