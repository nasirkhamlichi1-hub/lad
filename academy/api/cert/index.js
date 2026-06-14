const { client, ensureTable, json, verify, certifiedCount, getUser, P_PROGRESS } = require('../_shared');

function siteBase(req) {
  if (process.env.SITE_URL) return String(process.env.SITE_URL).replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + host;
}
async function sendCertEmail(toEmail, name, link) {
  const key = process.env.SENDGRID_KEY, from = process.env.CERT_FROM;
  if (!key || !from) return { emailed: false };
  const body = {
    personalizations: [{ to: [{ email: toEmail }] }],
    from: { email: from, name: 'Service Ambassador Academy' },
    subject: 'Your Service Ambassador certificate',
    content: [{ type: 'text/html', value:
      '<p>Dear ' + (name || 'Ambassador') + ',</p><p>Congratulations on certifying all 11 Legal Affairs Department services. View and print your certificate:</p><p><a href="' + link + '">' + link + '</a></p><p>— Government of Dubai, Legal Affairs Department</p>' }]
  };
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { emailed: r.ok };
}

module.exports = async function (context, req) {
  const token = req.method === 'GET' ? (req.query.t || '') : ((req.body && req.body.token) || req.query.t || '');
  const email = verify(token);
  if (!email) return json(context, 401, { error: 'This certificate link is not valid.' });

  let c;
  try { c = client(); await ensureTable(c); }
  catch (e) { return json(context, 500, { error: 'store unavailable' }); }

  let progress = {}, name = '', updated = '';
  try { const e = await c.getEntity(P_PROGRESS, email); progress = JSON.parse(e.progress || '{}'); name = e.name || ''; updated = e.updated || ''; } catch (_) {}
  if (!name) { const u = await getUser(c, email); if (u) name = u.name || ''; }
  const count = certifiedCount(progress);
  const completed = count >= 11;

  if (req.method === 'POST') {
    // self-service: a trainee app calls this on completion to receive their certificate by email
    if (!completed) return json(context, 200, { ok: false, certified: count, completed: false });
    const link = siteBase(req) + '/certificate.html?t=' + encodeURIComponent(token);
    const res = await sendCertEmail(email, name, link);
    return json(context, 200, { ok: true, completed: true, link, emailed: res.emailed });
  }

  return json(context, 200, { email, name, certified: count, completed, date: updated || new Date().toISOString() });
};
