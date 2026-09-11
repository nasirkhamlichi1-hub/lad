'use strict';

// ─────────────────────────────────────────────────────────────────────
// Brand — which organisation this instance serves.
// ─────────────────────────────────────────────────────────────────────
// One codebase, one container image, more than one deployment. The Dubai
// Legal Affairs Department runs the public CLPD platform; Living Horizon
// runs an internal staff-training portal on the same engine (learning
// spine, SCORM player, policy library, AI trainer) with its own database,
// its own users and none of the CLPD machinery — no credits, no lawyer
// roll, no accreditation.
//
// Selected with APP_BRAND (default 'lad' so every existing deployment is
// unchanged). Everything that needs to say the organisation's name, or to
// decide whether LAD-only seed data belongs in the database, reads it here.

const BRANDS = {
  lad: {
    id: 'lad',
    name: 'Legal Affairs Department',
    org: 'the Dubai Legal Affairs Department',
    programme: 'CLPD',
    // What the platform trains: used in the AI trainer's charter.
    learnerNoun: 'lawyer',
    trainerRole: 'professional one-to-one continuing legal professional development (CLPD) trainer',
    mailFromName: 'LAD CLPD',
    service: 'lad-clpd-backend',
    // The LAD-specific data migrations (lawyer roll, 2025 schedule, demo and
    // test sign-ins) apply on this brand only.
    ladData: true,
  },
  'living-horizon': {
    id: 'living-horizon',
    name: 'Living Horizon',
    org: 'Living Horizon',
    programme: 'Staff Training',
    learnerNoun: 'staff member',
    trainerRole: 'professional one-to-one staff trainer',
    mailFromName: 'Living Horizon Training',
    service: 'living-horizon-training-backend',
    ladData: false,
  },
};

const id = String(process.env.APP_BRAND || 'lad').toLowerCase().trim();
if (!BRANDS[id]) {
  throw new Error(`APP_BRAND must be one of ${Object.keys(BRANDS).join(', ')}; got '${id}'`);
}

const brand = Object.assign({}, BRANDS[id]);
// A deployment can put its own name on the portal without a code change.
if (process.env.APP_BRAND_NAME) brand.name = String(process.env.APP_BRAND_NAME).trim();
brand.isLad = brand.id === 'lad';

// What the frontend is allowed to know. No secrets, no infrastructure.
brand.public = () => ({
  id: brand.id, name: brand.name, programme: brand.programme, learner_noun: brand.learnerNoun,
});

module.exports = brand;
