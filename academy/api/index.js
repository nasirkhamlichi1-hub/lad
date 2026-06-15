// Azure Functions v4 (code-based) programming model — registers all academy
// endpoints. Replaces the classic function.json folders, which weren't being
// discovered on SWA managed functions.
const { app } = require('@azure/functions');
const S = require('./_shared');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function ok(body, status) {
  return { status: status || 200, jsonBody: body, headers: { 'Cache-Control': 'no-store' } };
}
function siteBase(request) {
  if (process.env.SITE_URL) return String(process.env.SITE_URL).replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return proto + '://' + host;
}

// ── tells the front-end a backend is present (hosted mode) ──
app.http('config', { methods: ['GET'], authLevel: 'anonymous', handler: async () => ok({ hosted: true }) });

// ── login ──
app.http('login', {
  methods: ['POST'], authLevel: 'anonymous', handler: async (request) => {
    let b = {}; try { b = await request.json(); } catch (_) {}
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!email || !EMAIL_RE.test(email)) return ok({ error: 'Please enter a valid email address.' }, 400);
    let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return ok({ error: 'Could not reach the training server. Try again shortly.' }, 500); }
    const user = await S.getUser(c, email);
    const enrolled = (user && user.active !== false) || S.envAllowed(email);
    if (!enrolled) return ok({ error: 'This email is not enrolled. Ask your training administrator to add you.' }, 403);
    let good = false;
    if (user && user.pass) good = S.checkPw(password, user.pass);
    else { const cfg = await S.getConfig(c); if (cfg && cfg.sharedHash) good = S.checkPw(password, cfg.sharedHash); else good = !!process.env.TRAINEE_PASSWORD && password === process.env.TRAINEE_PASSWORD; }
    if (!good) return ok({ error: 'That password is not correct.' }, 401);
    let progress = {}, name = (user && user.name) || '';
    try { const e = await c.getEntity(S.P_PROGRESS, email); progress = JSON.parse(e.progress || '{}'); if (e.name) name = e.name; } catch (_) {}
    return ok({ ok: true, token: S.sign(email), email, name, progress });
  }
});

// ── progress (load / save for the signed-in trainee) ──
app.http('progress', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', handler: async (request) => {
    let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return ok({ error: 'store unavailable' }, 500); }
    if (request.method === 'GET') {
      const email = S.verify(request.query.get('token') || '');
      if (!email) return ok({ error: 'Please sign in again.' }, 401);
      let progress = {}; try { const e = await c.getEntity(S.P_PROGRESS, email); progress = JSON.parse(e.progress || '{}'); } catch (_) {}
      return ok({ progress });
    }
    let b = {}; try { b = await request.json(); } catch (_) {}
    const email = S.verify(b.token || '');
    if (!email) return ok({ error: 'Please sign in again.' }, 401);
    const progress = b.progress || {};
    const name = String(b.name || '').slice(0, 80);
    try { await c.upsertEntity({ partitionKey: S.P_PROGRESS, rowKey: email, email, name, progress: JSON.stringify(progress), certified: S.certifiedCount(progress), updated: new Date().toISOString() }, 'Replace'); }
    catch (e) { return ok({ error: 'Could not save.' }, 500); }
    return ok({ ok: true });
  }
});

// ── admin: roster (GET) + management actions (POST) ──
app.http('admin', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', handler: async (request) => {
    let b = {}; if (request.method === 'POST') { try { b = await request.json(); } catch (_) {} }
    const pass = request.headers.get('x-admin-pass') || request.query.get('pass') || b.adminPass || '';
    let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return ok({ error: 'store unavailable' }, 500); }
    const cfgAuth = await S.getConfig(c);
    const envPass = process.env.ADMIN_PASSWORD || '';
    if (!envPass && !(cfgAuth && cfgAuth.adminHash)) return ok({ error: 'Admin is not configured (set ADMIN_PASSWORD).' }, 500);
    const passOk = (cfgAuth && cfgAuth.adminHash && S.checkPw(pass, cfgAuth.adminHash)) || (envPass && pass === envPass);
    if (!passOk) return ok({ error: 'Wrong admin password.' }, 401);

    if (request.method === 'GET') {
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
      const cfg = await S.getConfig(c);
      return ok({ users, sharedPasswordSet: !!(cfg && cfg.sharedHash) || !!process.env.TRAINEE_PASSWORD, emailConfigured: false });
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
        return ok({ ok: true, added, skipped });
      }
      if (action === 'removeUser') {
        if (!EMAIL_RE.test(email)) return ok({ error: 'Invalid email.' }, 400);
        try { await c.deleteEntity(S.P_USERS, email); } catch (_) {}
        if (b.alsoProgress) { try { await c.deleteEntity(S.P_PROGRESS, email); } catch (_) {} }
        return ok({ ok: true });
      }
      if (action === 'setActive') {
        if (!EMAIL_RE.test(email)) return ok({ error: 'Invalid email.' }, 400);
        await c.upsertEntity({ partitionKey: S.P_USERS, rowKey: email, active: !!b.active }, 'Merge');
        return ok({ ok: true });
      }
      if (action === 'setUserPassword') {
        if (!EMAIL_RE.test(email)) return ok({ error: 'Invalid email.' }, 400);
        const pw = String(b.password || '');
        await c.upsertEntity({ partitionKey: S.P_USERS, rowKey: email, pass: pw ? S.hashPw(pw) : '' }, 'Merge');
        return ok({ ok: true });
      }
      if (action === 'setSharedPassword') {
        const pw = String(b.password || '');
        if (pw.length < 4) return ok({ error: 'Choose a password of at least 4 characters.' }, 400);
        await c.upsertEntity({ partitionKey: S.P_CONFIG, rowKey: 'settings', sharedHash: S.hashPw(pw), updated: new Date().toISOString() }, 'Merge');
        return ok({ ok: true });
      }
      if (action === 'setAdminPassword') {
        const pw = String(b.password || '');
        if (pw.length < 4) return ok({ error: 'Choose a password of at least 4 characters.' }, 400);
        await c.upsertEntity({ partitionKey: S.P_CONFIG, rowKey: 'settings', adminHash: S.hashPw(pw), updated: new Date().toISOString() }, 'Merge');
        return ok({ ok: true });
      }
      return ok({ error: 'Unknown action.' }, 400);
    } catch (e) {
      context_log(e);
      return ok({ error: 'Action failed: ' + (e && e.message || 'error') }, 500);
    }
  }
});

// ── public certificate data (for certificate.html?t=token) ──
app.http('cert', {
  methods: ['GET'], authLevel: 'anonymous', handler: async (request) => {
    const email = S.verify(request.query.get('t') || '');
    if (!email) return ok({ error: 'This certificate link is not valid.' }, 401);
    let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return ok({ error: 'store unavailable' }, 500); }
    let progress = {}, name = '', updated = '';
    try { const e = await c.getEntity(S.P_PROGRESS, email); progress = JSON.parse(e.progress || '{}'); name = e.name || ''; updated = e.updated || ''; } catch (_) {}
    if (!name) { const u = await S.getUser(c, email); if (u) name = u.name || ''; }
    const count = S.certifiedCount(progress);
    return ok({ email, name, certified: count, completed: count >= 11, date: updated || new Date().toISOString() });
  }
});

function context_log(e) { try { console.error('admin action error', e && e.message); } catch (_) {} }
