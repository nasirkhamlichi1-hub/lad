'use strict';

// Loads the trainer-free feedback aggregates (seed-data/feedback-aggregates.json,
// produced by build-feedback.js) into course_feedback / provider_feedback.
// Idempotent — INSERT OR REPLACE. Safe to run on every deploy.

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const SRC = path.join(__dirname, '..', 'seed-data', 'feedback-aggregates.json');
if (!fs.existsSync(SRC)) {
  console.error(`✗ ${SRC} not found. Run: node scripts/build-feedback.js <2025.xlsx> <2026.xlsx>`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// Ensure tables exist even if migrations haven't been applied (e.g. local init-db).
db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '022-course-feedback.sql'), 'utf8'));

const insC = db.prepare(`INSERT OR REPLACE INTO course_feedback
  (course_key, year, course_id, course_name, provider_id, provider_name, responses, content, benefits, practical, overall, metrics_json)
  VALUES (@course_key, @year, @course_id, @course_name, @provider_id, @provider_name, @responses, @content, @benefits, @practical, @overall, @metrics_json)`);

const insP = db.prepare(`INSERT OR REPLACE INTO provider_feedback
  (provider_key, year, provider_id, provider_name, responses, knowledge, clarity, interaction, metrics_json)
  VALUES (@provider_key, @year, @provider_id, @provider_name, @responses, @knowledge, @clarity, @interaction, @metrics_json)`);

const a = (m, k) => (m && m[k] ? m[k].avg : null);

const loadCourses = db.transaction(() => {
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
});
const loadProviders = db.transaction(() => {
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

loadCourses();
loadProviders();
console.log(`✓ Feedback loaded: ${data.courses.length} course-year rows, ${data.providers.length} provider-year rows (generated ${data.generated_at}).`);
