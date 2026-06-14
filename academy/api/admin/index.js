const S = require('../_shared');
const { client, ensureTable, json, adminOk, hashPw, sign, certifiedCount, P_PROGRESS, P_USERS, P_CONFIG } = S;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function siteBase(req) {
  if (process.env.SITE_URL) return String(process.env.SITE_URL).replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + host;
}
function certLink(req, email) { return siteBase(req) + '/certificate.html?t=' + encodeURIComponent(sign(email)); }

// Optional email via SendGrid (set SENDGRID_KEY + CERT_FROM). No-op if not configured.
async function sendCertEmail(toEmail, name, link) {
  const key = process.env.SENDGRID_KEY, from = process.env.CERT_FROM;
  if (!key || !from) return { emailed: false, reason: 'email-not-configured' };
  const body = {
    personalizations: [{ to: [{ email: toEmail }] }],
    from: { email: from, name: 'Service Ambassador Academy' },
    subject: 'Your Service Ambassador certificate',
    content: [{ type: 'text/html', value:
      '<p>Dear ' + (name || 'Ambassador') + ',</p>' +
      '<p>Congratulations on completing the Service Ambassador Academy across all 11 Legal Affairs Department services.</p>' +
      '<p>View and print your certificate here:</p>' +
      '<p><a href="' + link + '">' + link + '</a></p>' +
      '<p>— Government of Dubai, Legal Affairs Department</p>' }]
  };
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { emailed: r.ok, reason: r.ok ? 'sent' : ('sendgrid-' + r.status) };
}

module.exports = async function (context, req) {
  if (!process.env.ADMIN_PASSWORD) return json(context, 500, { error: 'Admin is not configured (set ADMIN_PASSWORD).' });
  if (!adminOk(req)) return json(context, 401, { error: 'Wrong admin password.' });

  let c;
  try { c = client(); await ensureTable(c); }
  catch (e) { return json(context, 500, { error: 'store unavailable' }); }

  // ---- GET: full roster (enrolled users joined with their progress) ----
  if (req.method === 'GET') {
    const prog = {};
    for await (const e of c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P_PROGRESS}'` } })) {
      let p = {}; try { p = JSON.parse(e.progress || '{}'); } catch (_) {}
      prog[(e.email || e.rowKey).toLowerCase()] = { progress: p, name: e.name || '', certified: e.certified || certifiedCount(p), updated: e.updated || '' };
    }
    const users = [];
    const seen = new Set();
    for await (const u of c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P_USERS}'` } })) {
      const em = (u.email || u.rowKey).toLowerCase(); seen.add(em);
      const pr = prog[em] || {};
      users.push({ email: em, name: u.name || pr.name || '', active: u.active !== false, hasOwnPassword: !!u.pass,
        certified: pr.certified || 0, updated: pr.updated || '', progress: pr.progress || {} });
    }
    // include anyone who has progress but isn't formally enrolled (e.g. bootstrap via ALLOWED_EMAILS)
    Object.keys(prog).forEach(em => { if (!seen.has(em)) { const pr = prog[em]; users.push({ email: em, name: pr.name || '', active: true, hasOwnPassword: false, certified: pr.certified || 0, updated: pr.updated || '', progress: pr.progress || {} }); } });
    users.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    const cfg = await S.getConfig(c);
    return json(context, 200, { users, sharedPasswordSet: !!(cfg && cfg.sharedHash) || !!process.env.TRAINEE_PASSWORD, emailConfigured: !!(process.env.SENDGRID_KEY && process.env.CERT_FROM) });
  }

  // ---- POST: management actions ----
  const action = (req.body && req.body.action) || '';
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();

  try {
    if (action === 'addUser' || action === 'addUsers') {
      const items = action === 'addUsers'
        ? String((req.body && req.body.emails) || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
        : [email];
      const added = [], skipped = [];
      for (const em of items) {
        if (!EMAIL_RE.test(em)) { skipped.push(em); continue; }
        await c.upsertEntity({ partitionKey: P_USERS, rowKey: em, email: em, name: (action === 'addUser' ? (req.body.name || '') : ''), active: true, created: new Date().toISOString() }, 'Merge');
        added.push(em);
      }
      return json(context, 200, { ok: true, added, skipped });
    }

    if (action === 'removeUser') {
      if (!EMAIL_RE.test(email)) return json(context, 400, { error: 'Invalid email.' });
      try { await c.deleteEntity(P_USERS, email); } catch (_) {}
      if (req.body && req.body.alsoProgress) { try { await c.deleteEntity(P_PROGRESS, email); } catch (_) {} }
      return json(context, 200, { ok: true });
    }

    if (action === 'setActive') {
      if (!EMAIL_RE.test(email)) return json(context, 400, { error: 'Invalid email.' });
      await c.upsertEntity({ partitionKey: P_USERS, rowKey: email, active: !!(req.body && req.body.active) }, 'Merge');
      return json(context, 200, { ok: true });
    }

    if (action === 'setUserPassword') {
      if (!EMAIL_RE.test(email)) return json(context, 400, { error: 'Invalid email.' });
      const pw = String((req.body && req.body.password) || '');
      // empty password = clear it (fall back to the shared password)
      await c.upsertEntity({ partitionKey: P_USERS, rowKey: email, pass: pw ? hashPw(pw) : '' }, 'Merge');
      return json(context, 200, { ok: true });
    }

    if (action === 'setSharedPassword') {
      const pw = String((req.body && req.body.password) || '');
      if (pw.length < 4) return json(context, 400, { error: 'Choose a password of at least 4 characters.' });
      await c.upsertEntity({ partitionKey: P_CONFIG, rowKey: 'settings', sharedHash: hashPw(pw), updated: new Date().toISOString() }, 'Merge');
      return json(context, 200, { ok: true });
    }

    if (action === 'certLink') {
      if (!EMAIL_RE.test(email)) return json(context, 400, { error: 'Invalid email.' });
      return json(context, 200, { ok: true, link: certLink(req, email) });
    }

    if (action === 'sendCert') {
      if (!EMAIL_RE.test(email)) return json(context, 400, { error: 'Invalid email.' });
      const link = certLink(req, email);
      const name = String((req.body && req.body.name) || '');
      const res = await sendCertEmail(email, name, link);
      return json(context, 200, { ok: true, link, emailed: res.emailed, reason: res.reason });
    }

    return json(context, 400, { error: 'Unknown action.' });
  } catch (e) {
    context.log.error('admin action error', action, e && e.message);
    return json(context, 500, { error: 'Action failed: ' + (e && e.message || 'error') });
  }
};
