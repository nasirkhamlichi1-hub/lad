// Accreditation flow — applications (A1 provider + A2 course) submitted by
// providers/firms, reviewed and signed off by LAD oversight/admin, and once
// approved the course appears in the public accredited-course catalogue.
// Stored in Azure Table Storage, partition 'accred', rowKey = application id.
const S = require('../_shared');
const aimodel = require('../_aimodel');
const P = 'accred';
function newId() { return 'ac' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function genCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let x = ''; for (let i = 0; i < 5; i++) x += a[Math.floor(Math.random() * a.length)]; return 'CLPD-' + x; }
function s(v, n) { return String(v == null ? '' : v).slice(0, n); }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A reviewer is an admin/super-admin or an oversight-role user.
async function reviewer(c, req) {
  if (S.adminOk(req)) return { email: 'admin', role: 'admin' };
  const token = (req.query && req.query.token) || (req.body && req.body.token) || '';
  const email = S.verify(token);
  if (!email) return null;
  if (S.isSuper(email)) return { email, role: 'admin' };
  const u = await S.getUser(c, email);
  const role = S.userRole(email, u);
  return (role === 'admin' || role === 'oversight') ? { email, role } : null;
}

function view(e) {
  return { id: e.rowKey, type: e.type, orgName: e.orgName, orgType: e.orgType, contactName: e.contactName,
    contactEmail: e.contactEmail, phone: e.phone, website: e.website, about: e.about,
    courseTitle: e.courseTitle, format: e.format, durationHours: e.durationHours, cpdPoints: e.cpdPoints,
    areas: e.areas, summary: e.summary, outcomes: e.outcomes, status: e.status, reviewReason: e.reviewReason,
    reviewedBy: e.reviewedBy, decidedAt: e.decidedAt, createdAt: e.createdAt, courseCode: e.courseCode || null, aiScore: e.aiScore || null };
}
function pubCourse(e) {
  return { id: e.rowKey, title: e.courseTitle, provider: e.orgName, format: e.format,
    durationHours: e.durationHours, cpdPoints: e.cpdPoints, areas: e.areas, summary: e.summary, accreditedAt: e.decidedAt, courseCode: e.courseCode || null };
}

// AiModel assessment of an application — suggests points/score for the reviewer.
async function aiAssess(e) {
  if (!aimodel.configured()) return null;
  const sys = 'You are an accreditation assessor for the Dubai Legal Affairs Department CLPD programme. You assess a course-accreditation application and reply with ONLY a JSON object: {"recommendedPoints": <integer 0-8>, "score": <integer 0-100 overall quality/eligibility>, "verdict": "approve" | "revise" | "reject", "rationale": "<2-3 plain sentences>", "flags": ["<short concern>", ...]}. Judge relevance to legal practice, rigour, clear learning outcomes, and whether the CPD points requested fit the duration (about one point per contact hour). Be fair, specific and concise.';
  const usr = 'Application to assess:\n' + JSON.stringify({
    organisation: e.orgName, applicantType: e.orgType, course: e.courseTitle, format: e.format,
    durationHours: e.durationHours, pointsRequested: e.cpdPoints, areas: e.areas, summary: e.summary, outcomes: e.outcomes
  });
  const out = await aimodel.callAiModel({ system: sys, messages: [{ role: 'user', content: usr }], maxTokens: 450, temperature: 0.2 });
  if (!out) return null;
  try { const mm = out.match(/\{[\s\S]*\}/); if (mm) return JSON.parse(mm[0]); } catch (_) {}
  return { rationale: out };
}

module.exports = async function (context, req) {
  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  const m = req.method, q = req.query || {}, b = req.body || {};

  if (m === 'GET') {
    // Public catalogue of accredited (approved) courses.
    if (q.scope === 'catalogue') {
      const out = [];
      try { const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P}'` } });
        for await (const e of ents) { if (e.status === 'approved' && e.courseTitle) out.push(pubCourse(e)); } } catch (_) {}
      out.sort((a, b) => String(b.accreditedAt || '').localeCompare(String(a.accreditedAt || '')));
      return S.json(context, 200, { courses: out });
    }
    // An applicant's own submissions.
    if (q.scope === 'mine') {
      const email = S.verify(q.token || ''); if (!email) return S.json(context, 401, { error: 'Please sign in.' });
      const out = [];
      try { const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P}'` } });
        for await (const e of ents) { if (String(e.submittedByEmail || '').toLowerCase() === email) out.push(view(e)); } } catch (_) {}
      out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return S.json(context, 200, { applications: out });
    }
    // Reviewer: the full queue (optionally filtered by status).
    const rv = await reviewer(c, req);
    if (!rv) return S.json(context, 401, { error: 'Reviewer access required.' });
    const out = [];
    try { const ents = c.listEntities({ queryOptions: { filter: `PartitionKey eq '${P}'` } });
      for await (const e of ents) { if (!q.status || e.status === q.status) out.push(view(e)); } } catch (_) {}
    out.sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return S.json(context, 200, { applications: out });
  }

  // POST — AI assessment, decide (reviewer) or apply (anyone).
  if (b.action === 'ai-review') {
    const rv = await reviewer(c, req);
    if (!rv) return S.json(context, 401, { error: 'Reviewer access required.' });
    const id = String(b.id || ''); if (!id) return S.json(context, 400, { error: 'id required' });
    let e; try { e = await c.getEntity(P, id); } catch (_) { return S.json(context, 404, { error: 'Application not found.' }); }
    const sug = await aiAssess(e);
    if (!sug) return S.json(context, 200, { available: false, message: 'AI model is not configured.' });
    // Cache a short score summary on the record for the queue view.
    try { e.aiScore = s((sug.score != null ? sug.score + '/100 · ' : '') + (sug.recommendedPoints != null ? sug.recommendedPoints + ' pts · ' : '') + (sug.verdict || ''), 60); await c.upsertEntity(e, 'Merge'); } catch (_) {}
    return S.json(context, 200, { available: true, suggestion: sug });
  }
  if (b.action === 'decide') {
    const rv = await reviewer(c, req);
    if (!rv) return S.json(context, 401, { error: 'Reviewer access required.' });
    const id = String(b.id || ''); if (!id) return S.json(context, 400, { error: 'id required' });
    let e; try { e = await c.getEntity(P, id); } catch (_) { return S.json(context, 404, { error: 'Application not found.' }); }
    const dec = b.decision === 'approved' ? 'approved' : (b.decision === 'rejected' ? 'rejected' : null);
    if (!dec) return S.json(context, 400, { error: 'decision must be approved or rejected' });
    if (dec === 'rejected' && !String(b.reason || '').trim()) return S.json(context, 400, { error: 'A reason is required to reject.' });
    e.status = dec; e.reviewReason = s(b.reason, 1000); e.reviewedBy = rv.email; e.decidedAt = new Date().toISOString();
    if (dec === 'approved' && !e.courseCode) e.courseCode = genCode();   // issue the course code on approval
    try { await c.upsertEntity(e, 'Merge'); } catch (err) { context.log.error('decide', err && err.message); return S.json(context, 500, { error: 'Could not save the decision.' }); }
    return S.json(context, 200, { ok: true, id, status: dec, courseCode: e.courseCode || null });
  }

  // apply
  const ap = b.applicant || {}, cr = b.course || {};
  if (!EMAIL_RE.test(String(ap.contactEmail || ''))) return S.json(context, 400, { error: 'A valid contact email is required.' });
  if (!String(ap.orgName || '').trim()) return S.json(context, 400, { error: 'Organisation name is required.' });
  if (!String(cr.title || '').trim()) return S.json(context, 400, { error: 'Course title is required.' });
  const submittedByEmail = (S.verify(b.token || '') || String(ap.contactEmail).toLowerCase());
  const rec = { partitionKey: P, rowKey: newId(), type: 'course',
    orgName: s(ap.orgName, 160), orgType: s(ap.orgType, 40), contactName: s(ap.contactName, 120),
    contactEmail: String(ap.contactEmail).toLowerCase().slice(0, 120), phone: s(ap.phone, 40), website: s(ap.website, 200), about: s(ap.about, 2000),
    courseTitle: s(cr.title, 160), format: s(cr.format, 40), durationHours: s(cr.durationHours, 20), cpdPoints: s(cr.cpdPoints, 20),
    areas: s(cr.areas, 300), summary: s(cr.summary, 3000), outcomes: s(cr.outcomes, 3000),
    status: 'pending', submittedByEmail: submittedByEmail.slice(0, 120), createdAt: new Date().toISOString() };
  try { await c.createEntity(rec); } catch (e) { context.log.error('apply', e && e.message); return S.json(context, 500, { error: 'Could not submit your application.' }); }
  return S.json(context, 200, { ok: true, id: rec.rowKey });
};
