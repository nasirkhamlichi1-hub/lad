'use strict';

// Functional check for the freelance-lawyers instance — the Department's
// lite brand: a small cohort of individually licensed lawyers, every course
// free, no firms, no credits, no accredited-provider catalogue.
//
//   APP_BRAND=freelance NODE_ENV=development DATABASE_URL=./data/freelance-test.sqlite \
//     node scripts/migrate.js && node scripts/test-freelance.js
//
// Asserts what the brand promises: no LAD roll or demo sign-ins in the
// database, a lawyer account with no firm can be created and signed in,
// is a learner (enrolled, named on the cohort page, assignable, counted as
// "everyone"), and self-enrols on anything published.

const bcrypt = require('bcryptjs');
const brand = require('../src/brand');
const db = require('../src/db');
const topics = require('../src/lms/topics');
const store = require('../src/lms/store');
const learners = require('../src/services/learners');
const trainerStore = require('../src/services/trainerStore');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

async function main() {
  console.log(`\nFreelance lawyers — functional check (brand=${brand.id})\n`);
  check('brand is freelance (set APP_BRAND before running)', brand.id, 'freelance');
  check('learners are lawyers', brand.learnerKind, 'lawyer');
  check('with no firms', brand.firms, false);
  check('so "everyone" means the lawyers', learners.everyoneIsLawyers, true);

  // ─── the database carries no LAD data ──────────────────────────
  console.log('\ndatabase');
  const skipped = db.prepare("SELECT COUNT(*) n FROM _migrations WHERE checksum LIKE 'skipped:%'").get().n;
  check('LAD data migrations were skipped, not applied', skipped > 0, true);
  check('no lawyer roll', db.prepare('SELECT COUNT(*) n FROM lawyers').get().n, 0);
  check('no demo/test sign-ins', db.prepare("SELECT COUNT(*) n FROM staff WHERE LOWER(email) LIKE '%@lad.com' OR LOWER(email) LIKE '%@clpd.test' OR LOWER(email) LIKE '%legal.dubai.gov.ae'").get().n, 0);
  check('no 2025 CLPD schedule', db.prepare('SELECT COUNT(*) n FROM course_sessions').get().n, 0);

  // ─── lawyer accounts, created by an admin, no firm ─────────────
  console.log('\nlawyers');
  const ts = Date.now().toString(36);
  const adminId = `S-FLA-${ts}`;
  db.prepare("INSERT INTO staff (id, email, first_name, last_name, role, status, password_hash) VALUES (?,?,?,?,?,?,?)")
    .run(adminId, `admin.${ts}@freelance.test`, 'Training', 'Admin', 'lad_admin', 'active', 'x');
  const lawyerId = `L-FL-${ts}`;
  const hash = bcrypt.hashSync('Temp-Pass-1', 4);
  db.prepare(`INSERT INTO lawyers (id, email, first_name, last_name, firm_id, roll_number, password_hash, status, must_change_password, credit_balance)
              VALUES (?,?,?,?,NULL,?,?,'active',1,0)`)
    .run(lawyerId, `mariam.${ts}@freelance.test`, 'Mariam', 'Al Suwaidi', 'FL-0042', hash);
  const suspendedId = `L-FLS-${ts}`;
  db.prepare(`INSERT INTO lawyers (id, email, first_name, last_name, firm_id, password_hash, status, credit_balance)
              VALUES (?,?,?,?,NULL,?,'suspended',0)`)
    .run(suspendedId, `gone.${ts}@freelance.test`, 'Gone', 'Away', hash);

  const found = learners.findLearner(lawyerId);
  check('a firm-less lawyer resolves as a learner', found && found.kind, 'lawyer');
  check('with a name', found && found.name, 'Mariam Al Suwaidi');
  check('and a licence number', found && found.roll_number, 'FL-0042');
  check('and appears in "everyone"', learners.listLearners().some((l) => l.id === lawyerId), true);
  check('a suspended lawyer does not', learners.listLearners().some((l) => l.id === suspendedId), false);
  check('nor does the admin', learners.listLearners().some((l) => l.id === adminId), false);
  check('search finds them by name', learners.searchLearners('mariam').some((l) => l.id === lawyerId), true);
  check('and by licence number', learners.searchLearners('fl-0042').some((l) => l.id === lawyerId), true);

  // ─── a course, published, opened by a lawyer ───────────────────
  console.log('\ncourse');
  const topic = await topics.createTopic({ title: `Court etiquette ${ts}`, welcome: 'Welcome, counsel', steps: [{ kind: 'document' }, { kind: 'ai' }] }, adminId);
  const doc = topic.activities.find((a) => a.kind === 'document');
  const ai = topic.activities.find((a) => a.kind === 'ai_lesson');
  const matId = `MT-${ts}`;
  db.prepare("INSERT INTO course_materials (id, course_id, title, kind, url, created_at) VALUES (?,?,?,?,?,datetime('now'))")
    .run(matId, topic.topic_id, 'Advocacy code', 'link', 'https://legal.dubai.gov.ae/example/advocacy-code.pdf');
  await store.upsertActivity(topic.topic_id, { ...doc, material_id: matId });
  trainerStore.upsertLesson({ id: ai.lesson_id, title: ai.title, body: 'Address the bench as "Your Honour". Rise when the judge enters. File submissions three days before the hearing.', objectives: ['Address the bench correctly', 'File on time'], course_id: topic.topic_id, duration_min: 10, cpd_points: 0, active: false }, adminId);
  const pub = await topics.publishTopic(topic.topic_id);
  check('publishes both steps', pub.published, 2);

  await store.ensureEnrolment(topic.topic_id, lawyerId, 'self');
  const outline = await store.getOutline(topic.topic_id, lawyerId);
  check('the lawyer gets the outline with their enrolment', !!outline.enrolment, true);
  check('welcome travels with it', outline.welcome, 'Welcome, counsel');

  const att = await store.startAttempt({ activityId: doc.id, lawyerId });
  await store.checkpoint(att.id, lawyerId, { seconds: 90 });
  await store.closeAttempt(att.id, lawyerId, { completed: true, seconds: 120 });
  const enr = await store.getEnrolment(topic.topic_id, lawyerId);
  check('progress is derived (1 of 2 = 50%)', enr.percent, 50);
  check('time on task recorded', enr.total_seconds, 120);

  // ─── the cohort names the lawyer ───────────────────────────────
  console.log('\nreporting');
  const co = await store.cohort(topic.topic_id);
  const row = co.enrolments.find((e) => e.lawyer_id === lawyerId);
  check('cohort row carries the lawyer name', row && row.lawyer_name, 'Mariam Al Suwaidi');
  const ov = await store.overview({ days: 30, staleDays: 0.0001, coldHours: 2 });
  check('overview titles the course from its module', (ov.by_course.find((c) => c.course_id === topic.topic_id) || {}).course_title, `Court etiquette ${ts}`);

  // ─── cleanup ───────────────────────────────────────────────────
  await topics.deleteTopic(topic.topic_id);
  db.prepare('DELETE FROM lawyers WHERE id IN (?, ?)').run(lawyerId, suspendedId);
  db.prepare('DELETE FROM staff WHERE id = ?').run(adminId);

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nfailed:', e.message, '\n', e.stack); process.exit(1); });
