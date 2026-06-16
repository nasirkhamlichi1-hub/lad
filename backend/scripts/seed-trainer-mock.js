'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Seed: a single short MOCK lesson for testing the AI Trainer end-to-end.
// ─────────────────────────────────────────────────────────────────────────
//   node scripts/seed-trainer-mock.js
//
// Loads one ~6-minute lesson ("Mock Session — Good Faith in Negotiations")
// so you can run a complete test: start → it teaches the key elements one at
// a time → checks your attention → runs a quick scenario → finish to complete
// and award the CPD point (or pause and resume to test that path).
//
// Idempotent: stable id, so re-running updates it in place.

require('dotenv').config();
const trainerStore = require('../src/services/trainerStore');

const LESSON = {
  id: 'lsn_mock_session',
  title: 'Mock Session — Good Faith in Negotiations',
  summary: 'A short test lesson for trying the AI Trainer end-to-end.',
  course_id: 'mock-test',
  language: 'English',
  duration_min: 6,
  cpd_points: 1,
  active: true,
  objectives: [
    'Explain what the duty to negotiate in good faith means',
    'State what an injured party can recover when negotiations are broken off in bad faith (reliance loss, not lost profit)',
    'Apply the duty to a short scenario',
  ],
  body: [
    'This is a short mock training session used to test the trainer. Keep it light and quick, but still teach properly: cover the three key elements one at a time, ask a check question after each, and react to the lawyer\'s attention as you go.',
    'Key element one — the duty. Explain that, when parties negotiate a contract, each must negotiate in good faith: deal honestly, do not string the other side along, and do not walk away without justification once negotiations are well advanced. Ask the lawyer to give one example of bad-faith negotiating before you continue.',
    'Key element two — the remedy. If one party breaks off advanced negotiations in bad faith, the injured party can usually recover its reliance loss — the wasted costs it spent relying on the deal, such as due diligence and advisers\' fees — but not the profit it expected from the deal that never closed. Check that the lawyer can state this distinction back to you, because it is the point people get wrong.',
    'Key element three — apply it. Run this quick scenario: two companies negotiate for weeks. One spends heavily on due diligence after repeated assurances the deal will close. The other then walks away suddenly and without reason. Ask the lawyer: what can the injured company claim, and what can it not claim? Confirm they land on reliance loss (the wasted costs), not the lost profit.',
    'When all three key elements are covered and understood, give a one-line recap, congratulate them, and close the session. Keep your turns short throughout, and if they look distracted or pick up their phone, gently bring them back before moving on.',
  ].join('\n\n'),
};

function main() {
  const saved = trainerStore.upsertLesson(LESSON, 'mock-seed');
  console.log('✅ Mock lesson ready:');
  console.log('   id            :', saved.id);
  console.log('   title         :', saved.title);
  console.log('   duration/CPD  :', saved.duration_min + ' min,', saved.cpd_points, 'CPD');
  console.log('   key elements  :', saved.objectives.length);
  console.log('\nIt now appears in the AI Trainer — pick it on ai-trainer.html and start a session.');
}

main();
