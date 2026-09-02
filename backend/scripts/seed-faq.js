'use strict';

// ─────────────────────────────────────────────────────────────────────
// Seeds the CLPD FAQ — the Department's published answers.
// ─────────────────────────────────────────────────────────────────────
// These are the questions and answers already shown on the CLPD portal's
// FAQ page. Holding them server-side does two things: it puts them behind
// the existing admin editor (PUT /api/v1/faq), and it gives Maryam a
// source of record. Before this, the faq table was empty and she had
// nothing to answer from — which is why a lawyer asking a real question
// got a greeting and then a hand-off to a person.
//
// Idempotent: only seeds when the table has no active rows, so an admin's
// edits are never overwritten by a redeploy.

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

function main() {
  let existing = 0;
  try { existing = db.prepare('SELECT COUNT(*) n FROM faq WHERE active = 1').get().n; }
  catch (e) { console.log('[seed-faq] no faq table yet — run migrations first'); return; }

  if (existing > 0) {
    console.log(`[seed-faq] ${existing} active entries already — leaving them alone`);
    return;
  }

  const file = path.join(__dirname, '..', 'seed-data', 'clpd-faq.json');
  if (!fs.existsSync(file)) { console.log('[seed-faq] no seed file at ' + file); return; }
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));

  const ins = db.prepare(`
    INSERT INTO faq (question, answer, category, display_order, active, updated_at)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  `);
  db.transaction((arr) => {
    arr.forEach((f, i) => ins.run(f.question, f.answer, f.category || null, f.display_order ?? i * 10));
  })(items);

  console.log(`[seed-faq] ✓ seeded ${items.length} CLPD FAQ entries`);
}

try { main(); } catch (e) { console.error('[seed-faq] failed:', e.message); }
