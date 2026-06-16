'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Seed: "Litigation & Arbitration in Aviation Law" CLPD session.
// ─────────────────────────────────────────────────────────────────────────
// Built from the LAD CLPD seminar deck by Dr Ashraf Amin Farag. Loads the
// programme into the AI Trainer from the canonical course file
// courses/aviation-law.json — the SAME file you can upload via the admin page
// (lad-trainer-admin.html → Import JSON). One source of truth, two load paths.
//
//   node scripts/seed-trainer-aviation.js
//
// Idempotent: lessons have stable ids, so re-running updates them in place.
//
// Source-anchored: figures and article numbers (113,000 SDR; 150 AED/kg;
// 3,000 AED; 7/14/21-day notice; 2-year limitation; Article 359; UAE Law
// 18/1993 as amended by Decree-Law 14/2020; Article 235 of Law 11/1992;
// New York Convention 1958) are taken from the deck. Confirm against the
// official texts before relying on them in practice.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const trainerStore = require('../src/services/trainerStore');

const COURSE_FILE = path.join(__dirname, '..', 'courses', 'aviation-law.json');

function main() {
  const lessons = JSON.parse(fs.readFileSync(COURSE_FILE, 'utf8'));
  console.log(`[seed] loading ${lessons.length} lessons from ${path.relative(process.cwd(), COURSE_FILE)}…`);
  for (const L of lessons) {
    const saved = trainerStore.upsertLesson(L, 'seed-aviation');
    console.log(`  ✓ ${saved.id}  ${saved.title}  (${saved.duration_min} min, ${saved.cpd_points} CPD, ${saved.objectives.length} key elements)`);
  }
  const totalMin = lessons.reduce((s, L) => s + (L.duration_min || 0), 0);
  const totalCpd = lessons.reduce((s, L) => s + (L.cpd_points || 0), 0);
  console.log(`\n[seed] done — ${lessons.length} lessons, ~${totalMin} min total, ${totalCpd} CPD points.`);
  console.log('[seed] They now appear in the AI Trainer (admin: lad-trainer-admin.html; lawyer: ai-trainer.html).');
}

main();
