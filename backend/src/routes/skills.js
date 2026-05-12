'use strict';

const express = require('express');
const router = express.Router();
const skills = require('../services/skills');
const store = require('../services/store');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');

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
  const isLAD = ['lad_admin','lad_intelligence'].includes(u.role);
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
