'use strict';

// Role-aware AI assistant for the non-admin portals.
//   POST /command  { prompt } -> { intent:'answer', answer } | a confirmable plan
// LAD admin/oversight roles use /admin/command (richer, with session actions).

const express = require('express');
const router = express.Router();
const db = require('../db');
const store = require('../services/store');
const aimodel = require('../services/aimodel');
const { requireAuth } = require('../middleware/auth');

function daysToDec31() {
  const t = new Date(); const d = new Date(Date.UTC(t.getUTCFullYear(), 11, 31));
  return Math.max(0, Math.ceil((d - t) / 86400000));
}
function lawyerCtx(u) {
  const l = u.user_type === 'lawyer' ? store.getLawyerById(u.sub) : (u.email ? store.getLawyerByEmail(u.email) : null);
  if (!l) return null;
  const points = Number(l.lifetime_points) || 0;
  let completed = [];
  try { completed = db.prepare('SELECT course_title FROM cpd_records WHERE lawyer_id = ? LIMIT 20').all(l.id).map((r) => r.course_title).filter(Boolean); } catch (_) {}
  return { firstName: l.first_name || 'there', points, needed: Math.max(0, 16 - points), daysLeft: daysToDec31(),
    credits: Number(l.credit_balance) || 0, firm: l.firm_name || '', specialisms: l.practice_areas || '', completed };
}
function firmCtx(u) {
  const firmId = u.firm_id; if (!firmId) return null;
  let firm = {}; try { firm = db.prepare('SELECT name FROM firms WHERE id = ?').get(firmId) || {}; } catch (_) {}
  let agg = {}; try {
    agg = db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN COALESCE(lifetime_points,0)<8 THEN 1 ELSE 0 END) critical, SUM(CASE WHEN COALESCE(lifetime_points,0)>=8 AND COALESCE(lifetime_points,0)<16 THEN 1 ELSE 0 END) atRisk, SUM(CASE WHEN COALESCE(lifetime_points,0)>=16 THEN 1 ELSE 0 END) compliant, ROUND(AVG(COALESCE(lifetime_points,0)),1) avgPoints, COALESCE(SUM(credit_balance),0) pooledCredits FROM lawyers WHERE firm_id = ?").get(firmId) || {};
  } catch (_) {}
  return Object.assign({ firm: firm.name || '', daysLeft: daysToDec31() }, agg);
}
function providerCtx(u) {
  const name = u.name || u.email || '';
  let counts = {}; try {
    counts = db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM accreditations WHERE LOWER(submitted_by) LIKE ? OR payload LIKE ?").get('%' + name.toLowerCase() + '%', '%' + name + '%') || {};
  } catch (_) {}
  return { provider: name, accreditations: counts };
}

router.post('/command', requireAuth, async (req, res, next) => {
  const u = req.user; const role = u.role || u.user_type;
  const prompt = (req.body && req.body.prompt || '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'Ask a question.' });

  let ctx = {}, who = 'a LAD user', firmMode = false;
  if (u.user_type === 'lawyer' || role === 'lawyer') { ctx = lawyerCtx(u) || {}; who = 'a Dubai lawyer about their own CLPD compliance, courses and credits'; }
  else if (role === 'firm_compliance_officer') { ctx = firmCtx(u) || {}; who = 'a law-firm compliance officer about their firm'; firmMode = true; }
  else if (role === 'provider_admin') { ctx = providerCtx(u) || {}; who = 'an accredited training provider'; }

  if (!aimodel.configured()) {
    return res.json({ intent: 'answer', engine: 'snapshot', answer: 'AI is not configured here. Live context: ' + JSON.stringify(ctx) });
  }
  let system;
  if (firmMode) {
    system = 'You are Maryam, assisting a law-firm compliance officer. Use ONLY the provided live firm context (JSON), with real numbers. Lawyers need 16 CPD points by 31 December; <8 critical, 8-15 at risk, 16+ compliant. '
      + 'You can ANSWER questions or PROPOSE one action: message the firm\'s own lawyers. Reply with ONLY JSON. '
      + 'Question -> {"intent":"answer","answer":string}. Message the firm -> {"intent":"notify_firm","summary":string,"params":{"title":string,"body":string}} (write a professional title and 2-4 sentence body). Be concise.';
  } else {
    system = 'You are Maryam, the LAD CLPD assistant, helping ' + who + '. Use ONLY the provided live context (JSON), with the real numbers. '
      + 'Lawyers need 16 CPD points by 31 December; <8 critical, 8-15 at risk, 16+ compliant. Be concise, warm and practical. Plain text, no markdown headings.';
  }
  try {
    const text = await aimodel.chat({ system, messages: [{ role: 'user', content: 'Live context:\n' + JSON.stringify(ctx) + '\n\nUser says: ' + prompt }], maxTokens: 520, temperature: 0.35 });
    if (firmMode) {
      let p = null; try { const m = text.match(/\{[\s\S]*\}/); p = JSON.parse(m ? m[0] : text); } catch (_) {}
      if (p && p.intent === 'notify_firm' && p.params) { p.engine = 'aimodel'; return res.json(p); }
      return res.json({ intent: 'answer', engine: 'aimodel', answer: (p && p.answer) || text });
    }
    res.json({ intent: 'answer', engine: 'aimodel', answer: text });
  } catch (e) {
    if (e.code === 'AIMODEL_ERROR') return res.status(502).json({ error: 'AiModel call failed' });
    next(e);
  }
});

module.exports = router;
