'use strict';

const express = require('express');
const router = express.Router();
const skills = require('../services/skills');
const store = require('../services/store');
const db = require('../db');
const aimodel = require('../services/aimodel');
const log = require('../logger');
const { requireAuth, requireRole, optionalAuth, isSuper } = require('../middleware/auth');

// Approved accredited courses (for skill→course matching).
function catalogue() {
  try {
    return db.prepare("SELECT * FROM accreditations WHERE status='approved' AND accreditation_code IS NOT NULL ORDER BY reviewed_at DESC LIMIT 80").all()
      .map((r) => { let p = {}; try { p = JSON.parse(r.payload || '{}'); } catch (_) {}
        return { code: r.accreditation_code, title: p.courseTitle || p.course || p.title || r.ref,
          points: r.final_points != null ? r.final_points : (p.pointsRequested || 0),
          areas: p.areas || '', provider: p.providerName || p.firm || r.submitted_by || '' }; });
  } catch (_) { return []; }
}

function heuristicMatch(areas, courses) {
  const dev = areas.filter((a) => (Number(a.level) || 0) <= 3).map((a) => String(a.area || '').toLowerCase()).filter(Boolean);
  const score = (c) => {
    const hay = ((c.areas || '') + ' ' + (c.title || '')).toLowerCase();
    return dev.reduce((s, a) => s + (a && hay.includes(a.split(/[ ,/]/)[0]) ? 1 : 0), 0);
  };
  return courses.map((c) => ({ code: c.code, title: c.title, points: c.points, priority: 'medium',
    rationale: 'Matches a practice area you want to strengthen.', _s: score(c) }))
    .sort((a, b) => b._s - a._s).slice(0, 5).map(({ _s, ...r }) => r);
}

// POST /api/v1/skills/analyze — AiModel skill map + course matching from a
// lawyer's self-assessment. Falls back to keyword matching if AiModel is off.
router.post('/analyze', requireAuth, async (req, res, next) => {
  const b = req.body || {};
  const areas = Array.isArray(b.skills) ? b.skills.filter((a) => a && a.area).slice(0, 14) : [];
  const goals = String(b.goals || '').slice(0, 700);
  const experience = String(b.experience || '').slice(0, 900);
  const courses = catalogue();

  let lawyer = null;
  try { lawyer = req.user.user_type === 'lawyer' ? store.getLawyerById(req.user.sub) : (req.user.email ? store.getLawyerByEmail(req.user.email) : null); } catch (_) {}
  const points = lawyer ? (Number(lawyer.lifetime_points) || 0) : 0;

  if (aimodel.configured()) {
    try {
      const skillsStr = areas.map((a) => `${a.area} (self-rated ${a.level}/5)`).join('; ') || 'none specified';
      const courseList = courses.map((c) => `- ${c.title} [${c.code}] · ${c.points} pts · areas: ${c.areas || 'general'}`).join('\n') || '(no accredited courses available yet)';
      const system = 'You are Maryam, a CLPD skills advisor for the Dubai Legal Affairs Department. Analyse a lawyer\'s self-assessed legal skills, identify strengths, developing areas and gaps, and recommend specific accredited courses from the provided catalogue that best close their gaps and earn CPD points toward the 16-point cycle. Reply with ONLY a JSON object of the form: {"summary": string, "strengths": [string], "developing": [string], "gaps": [string], "radar": [{"axis": string, "you": number 0-100, "target": number 0-100}], "recommendations": [{"code": string, "title": string, "points": number, "rationale": string, "priority": "high"|"medium"|"low"}]}. Pick 3-6 recommendations STRICTLY from the catalogue using their exact code and title. Radar must have 5-7 axes reflecting the lawyer\'s practice areas. No prose outside the JSON.';
      const user = `Lawyer self-assessment:\nSkills: ${skillsStr}\nCareer goals: ${goals || 'n/a'}\nExperience notes: ${experience || 'n/a'}\nCurrent CPD points: ${points}/16\n\nAccredited course catalogue:\n${courseList}`;
      const text = await aimodel.chat({ system, messages: [{ role: 'user', content: user }], maxTokens: 1000, temperature: 0.3 });
      let parsed = null; try { const m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); } catch (_) {}
      if (parsed && (parsed.recommendations || parsed.radar)) return res.json(Object.assign({ engine: 'aimodel' }, parsed));
    } catch (e) { log.error('skills_analyze_aimodel', { error: e.message }); }
  }

  // Heuristic fallback
  const radar = areas.slice(0, 7).map((a) => ({ axis: a.area, you: Math.round((Number(a.level) || 0) / 5 * 100), target: 80 }));
  res.json({
    engine: 'heuristic',
    summary: 'Based on your self-assessment and the accredited catalogue, here are the courses that best match the areas you want to develop.',
    strengths: areas.filter((a) => (Number(a.level) || 0) >= 4).map((a) => a.area),
    developing: areas.filter((a) => (Number(a.level) || 0) === 3).map((a) => a.area),
    gaps: areas.filter((a) => (Number(a.level) || 0) <= 2).map((a) => a.area),
    radar,
    recommendations: heuristicMatch(areas, courses),
  });
});

// GET /api/v1/skills/taxonomy — public read of the controlled vocabulary
router.get('/taxonomy', optionalAuth, (req, res) => {
  if (req.query.flat) return res.json(skills.getTaxonomyFlat());
  res.json(skills.getTaxonomyTree());
});

// GET /api/v1/skills/me — current lawyer's skill graph
router.get('/me', requireAuth, (req, res) => {
  if (req.user.user_type !== 'lawyer') {
    return res.status(403).json({ error: 'Only lawyers can access this endpoint' });
  }
  res.json({
    lawyer_id:        req.user.sub,
    skills:           skills.computeLawyerSkills(req.user.sub),
    recommendations:  skills.getRecommendations(req.user.sub),
  });
});

// GET /api/v1/skills/lawyers/:id — specific lawyer (RBAC)
router.get('/lawyers/:id', requireAuth, (req, res) => {
  const u = req.user;
  const lawyer = store.getLawyerById(req.params.id);
  if (!lawyer) return res.status(404).json({ error: 'Lawyer not found' });

  const allowed =
    isSuper(u.role) ||
    (u.role === 'lad_admin' || u.role === 'lad_intelligence') ||
    (u.role === 'firm_compliance_officer' && u.firm_id === lawyer.firm_id) ||
    (u.user_type === 'lawyer' && u.sub === lawyer.id);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  res.json({
    lawyer_id:       lawyer.id,
    lawyer_name:     `${lawyer.first_name || ''} ${lawyer.last_name || ''}`.trim(),
    firm_id:         lawyer.firm_id,
    skills:          skills.computeLawyerSkills(lawyer.id),
    recommendations: skills.getRecommendations(lawyer.id),
  });
});

// GET /api/v1/skills/firms/:id — firm capabilities map
router.get('/firms/:id', requireAuth, (req, res) => {
  const u = req.user;
  const isLAD = isSuper(u.role) || ['lad_admin','lad_intelligence'].includes(u.role);
  const isOwnCO = u.role === 'firm_compliance_officer' && u.firm_id === req.params.id;
  const isOwnLawyer = u.user_type === 'lawyer' && u.firm_id === req.params.id;
  if (!isLAD && !isOwnCO && !isOwnLawyer) return res.status(403).json({ error: 'Forbidden' });

  const firm = store.getFirmById(req.params.id);
  if (!firm) return res.status(404).json({ error: 'Firm not found' });

  res.json({
    firm_id:      firm.id,
    firm_name:    firm.name,
    capabilities: skills.computeFirmCapabilities(req.params.id),
  });
});

// GET /api/v1/skills/heatmap — profession-wide (LAD only)
router.get('/heatmap', requireRole('lad_admin', 'lad_intelligence'), (_req, res) => {
  res.json({
    generated_at: new Date().toISOString(),
    topics:       skills.computeProfessionHeatmap(),
  });
});

// POST /api/v1/skills/rebuild — force a rebuild of all skill_events
// (LAD admin; called after a bulk attendance import or schema change)
router.post('/rebuild', requireRole('lad_admin'), (_req, res) => {
  res.json(skills.rebuildAllSkillEvents());
});

module.exports = router;
