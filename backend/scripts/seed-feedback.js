'use strict';

// Loads the trainer-free feedback aggregates (seed-data/feedback-aggregates.json,
// produced by build-feedback.js) into course_feedback / provider_feedback.
// Idempotent — INSERT OR REPLACE. Safe to run on every deploy, and also called
// lazily by the feedback service if the tables are ever found empty.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'seed-data', 'feedback-aggregates.json');
const MIGRATION = path.join(__dirname, '..', 'migrations', '022-course-feedback.sql');

// Load the committed aggregates into the given db handle. Returns counts, or
// null if the source file is missing. Throws only on a hard DB error.
function loadFeedback(db) {
  if (!fs.existsSync(SRC)) return null;
  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));

  // Ensure tables exist even if migrations haven't been applied yet.
  db.exec(fs.readFileSync(MIGRATION, 'utf8'));

  const insC = db.prepare(`INSERT OR REPLACE INTO course_feedback
    (course_key, year, course_id, course_name, provider_id, provider_name, responses, content, benefits, practical, overall, metrics_json)
    VALUES (@course_key, @year, @course_id, @course_name, @provider_id, @provider_name, @responses, @content, @benefits, @practical, @overall, @metrics_json)`);
  const insP = db.prepare(`INSERT OR REPLACE INTO provider_feedback
    (provider_key, year, provider_id, provider_name, responses, knowledge, clarity, interaction, metrics_json)
    VALUES (@provider_key, @year, @provider_id, @provider_name, @responses, @knowledge, @clarity, @interaction, @metrics_json)`);

  const a = (m, k) => (m && m[k] ? satStar(m[k].dist, m[k].avg) : null);

  // Displayed score = 5 × proportion who rated Good or better (3+), i.e. the
  // satisfaction % mapped onto 5 stars (100%→5, 80%→4, 60%→3 …). Falls back to
  // the raw mean if no distribution is available.
  function satStar(dist, mean) {
    if (!dist) return mean == null ? null : mean;
    const tot = (dist[1] || 0) + (dist[2] || 0) + (dist[3] || 0) + (dist[4] || 0) + (dist[5] || 0);
    if (!tot) return null;
    return Math.round(((dist[3] || 0) + (dist[4] || 0) + (dist[5] || 0)) / tot * 5 * 100) / 100;
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM course_feedback').run();
    for (const c of data.courses) {
      insC.run({
        course_key: c.course_key, year: c.year, course_id: c.course_id, course_name: c.course_name,
        provider_id: c.provider_id, provider_name: c.provider_name, responses: c.responses,
        content: a(c.metrics, 'content'), benefits: a(c.metrics, 'benefits'),
        practical: a(c.metrics, 'practical'), overall: a(c.metrics, 'overall'),
        metrics_json: JSON.stringify(c.metrics),
      });
    }
    db.prepare('DELETE FROM provider_feedback').run();
    for (const p of data.providers) {
      insP.run({
        provider_key: p.provider_id || ('unmapped:' + (p.provider_name || '').toLowerCase()),
        year: p.year, provider_id: p.provider_id, provider_name: p.provider_name, responses: p.responses,
        knowledge: a(p.metrics, 'knowledge'), clarity: a(p.metrics, 'clarity'), interaction: a(p.metrics, 'interaction'),
        metrics_json: JSON.stringify(p.metrics),
      });
    }
  });
  tx();
  return { courses: data.courses.length, providers: data.providers.length, generated_at: data.generated_at };
}

module.exports = { loadFeedback };

// CLI entry point: node scripts/seed-feedback.js
if (require.main === module) {
  const db = require('../src/db');
  if (!fs.existsSync(SRC)) {
    console.error(`✗ ${SRC} not found. Run: node scripts/build-feedback.js <2025.xlsx> <2026.xlsx>`);
    process.exit(1);
  }
  const r = loadFeedback(db);
  console.log(`✓ Feedback loaded: ${r.courses} course-year rows, ${r.providers} provider-year rows (generated ${r.generated_at}).`);
}
