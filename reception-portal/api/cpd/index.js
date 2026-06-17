// CPD ledger. After an accredited course runs, the provider uploads attendees
// with the course code; each attendee earns the course's CPD points, which the
// lawyer sees in their own CPD record.
//   POST { action:'attend', courseCode, attendees:[{email,name}], token } -> provider/admin
//   GET  ?token=                       -> the signed-in lawyer's CPD records
//   GET  ?courseCode=&token=           -> attendees recorded for a course (provider/admin)
const S = require('../_shared');
const P = 'cpd', PA = 'accred';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function courseByCode(c, code) {
  const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${PA}'` } });
  for await (const e of ents) { if (String(e.courseCode || '').toUpperCase() === code) return e; }
  return null;
}

module.exports = async function (context, req) {
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  const m = req.method, q = req.query || {}, b = req.body || {};

  if (m === 'GET') {
    const email = S.verify(q.token || '');
    if (!email) return S.json(context, 401, { error: 'Please sign in.' });

    if (q.courseCode) {
      const code = String(q.courseCode).trim().toUpperCase();
      const course = await courseByCode(c, code);
      const owner = course && (String(course.submittedByEmail || '').toLowerCase() === email || String(course.contactEmail || '').toLowerCase() === email);
      if (!owner && !S.isSuper(email)) return S.json(context, 403, { error: 'Only the course provider can view its attendees.' });
      const out = [];
      try { const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P}'` } });
        for await (const e of ents) { if (String(e.courseCode || '').toUpperCase() === code) out.push({ email: e.attendeeEmail, name: e.attendeeName, points: e.points, at: e.createdAt }); } } catch (_) {}
      return S.json(context, 200, { courseCode: code, courseTitle: course && course.courseTitle, attendees: out });
    }

    // the signed-in lawyer's own CPD
    const out = []; let total = 0;
    try { const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P}'` } });
      for await (const e of ents) { if (String(e.attendeeEmail || '').toLowerCase() === email) { out.push({ courseTitle: e.courseTitle, provider: e.provider, points: e.points, courseCode: e.courseCode, at: e.createdAt }); total += Number(e.points) || 0; } } } catch (_) {}
    out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return S.json(context, 200, { total, records: out });
  }

  // POST — upload attendees
  if (b.action === 'attend') {
    const email = S.verify(b.token || '');
    if (!email) return S.json(context, 401, { error: 'Please sign in.' });
    const code = String(b.courseCode || '').trim().toUpperCase();
    if (!code) return S.json(context, 400, { error: 'Course code is required.' });
    const course = await courseByCode(c, code);
    if (!course || course.status !== 'approved') return S.json(context, 404, { error: 'No approved course found for that code.' });
    const owner = String(course.submittedByEmail || '').toLowerCase() === email || String(course.contactEmail || '').toLowerCase() === email;
    if (!owner && !S.isSuper(email)) return S.json(context, 403, { error: 'Only the course provider can upload attendees.' });
    const points = parseInt(course.cpdPoints, 10) || 0;
    const list = Array.isArray(b.attendees) ? b.attendees : [];
    let added = 0, skipped = 0;
    for (const a of list) {
      const ae = String((a && a.email) || a || '').trim().toLowerCase();
      if (!EMAIL_RE.test(ae)) { skipped++; continue; }
      try { await c.upsertEntity({ partitionKey: P, rowKey: ae + '::' + code, attendeeEmail: ae, attendeeName: String((a && a.name) || '').slice(0, 120), courseCode: code, courseTitle: course.courseTitle, provider: course.orgName, points, createdAt: new Date().toISOString(), uploadedBy: email }, 'Replace'); added++; } catch (e) { skipped++; }
    }
    return S.json(context, 200, { ok: true, added, skipped, points, courseTitle: course.courseTitle });
  }

  return S.json(context, 400, { error: 'bad request' });
};
