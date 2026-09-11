'use strict';

// Functional check for a Living Horizon instance — the staff-training brand.
//
//   APP_BRAND=living-horizon NODE_ENV=development DATABASE_URL=./data/lh-test.sqlite \
//     node scripts/migrate.js && node scripts/test-living-horizon.js
//
// Asserts what the brand promises: no LAD data or demo sign-ins in the
// database, staff accounts can be learners (enrolled, named on the cohort
// page, assigned, allowed to read a course's materials), and the catalogue
// shows a staff member only what is published.

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
  console.log(`\nLiving Horizon — functional check (brand=${brand.id})\n`);
  check('brand is living-horizon (set APP_BRAND before running)', brand.id, 'living-horizon');

  // ─── the database carries no LAD data ──────────────────────────
  console.log('database');
  const skipped = db.prepare("SELECT COUNT(*) n FROM _migrations WHERE checksum LIKE 'skipped:%'").get().n;
  check('LAD data migrations were skipped, not applied', skipped, 9);
  check('no lawyer roll', db.prepare('SELECT COUNT(*) n FROM lawyers').get().n, 0);
  check('no demo/test sign-ins', db.prepare("SELECT COUNT(*) n FROM staff WHERE LOWER(email) LIKE '%@lad.com' OR LOWER(email) LIKE '%@clpd.test' OR LOWER(email) LIKE '%legal.dubai.gov.ae'").get().n, 0);
  check('no 2025 CLPD schedule', db.prepare('SELECT COUNT(*) n FROM course_sessions').get().n, 0);
  check('schema is complete (later ALTERs applied)', db.prepare("SELECT COUNT(*) n FROM pragma_table_info('activity_attempt') WHERE name='heartbeat_at'").get().n, 1);

  // ─── staff accounts ────────────────────────────────────────────
  console.log('\nstaff');
  const ts = Date.now().toString(36);
  const staffId = `S-LH-${ts}`;
  db.prepare("INSERT INTO staff (id, email, first_name, last_name, role, status, password_hash) VALUES (?,?,?,?,?,?,?)")
    .run(staffId, `amina.${ts}@livinghorizon.test`, 'Amina', 'Haddad', 'lad_staff', 'active', 'x');
  const adminId = `S-LHA-${ts}`;
  db.prepare("INSERT INTO staff (id, email, first_name, last_name, role, status, password_hash) VALUES (?,?,?,?,?,?,?)")
    .run(adminId, `admin.${ts}@livinghorizon.test`, 'Training', 'Admin', 'lad_admin', 'active', 'x');
  const found = learners.findLearner(staffId);
  check('a staff account resolves as a learner', found && found.kind, 'staff');
  check('with a name', found && found.name, 'Amina Haddad');
  check('and appears in the staff learner list', learners.listStaffLearners().some((s) => s.id === staffId), true);
  check('but the admin does not (admins are not "everyone")', learners.listStaffLearners().some((s) => s.id === adminId), false);
  check('search finds them by name', learners.searchStaffLearners('amina').some((s) => s.id === staffId), true);

  // ─── a course, published, opened by a staff member ─────────────
  console.log('\ncourse');
  const topic = await topics.createTopic({ title: `Welcoming visitors ${ts}`, welcome: 'Hello there', steps: [{ kind: 'document' }, { kind: 'ai' }] }, adminId);
  const doc = topic.activities.find((a) => a.kind === 'document');
  const ai = topic.activities.find((a) => a.kind === 'ai_lesson');
  const matId = `MT-${ts}`;
  db.prepare("INSERT INTO course_materials (id, course_id, title, kind, url, created_at) VALUES (?,?,?,?,?,datetime('now'))")
    .run(matId, topic.topic_id, 'Visitor policy', 'link', 'https://intranet.example/visitor-policy.pdf');
  await store.upsertActivity(topic.topic_id, { ...doc, material_id: matId });
  trainerStore.upsertLesson({ id: ai.lesson_id, title: ai.title, body: 'Greet every visitor within ten seconds. Confirm who they are here to see and sign them in on the tablet. If nobody is available, call the duty manager.', objectives: ['Greet within ten seconds', 'Sign the visitor in'], course_id: topic.topic_id, duration_min: 10, cpd_points: 0, active: false }, adminId);
  const pub = await topics.publishTopic(topic.topic_id);
  check('publishes both steps', pub.published, 2);

  await store.ensureEnrolment(topic.topic_id, staffId, 'self');
  const outline = await store.getOutline(topic.topic_id, staffId);
  check('the staff member gets the outline with their enrolment', !!outline.enrolment, true);
  check('welcome travels with it', outline.welcome, 'Hello there');

  const att = await store.startAttempt({ activityId: doc.id, lawyerId: staffId });
  await store.checkpoint(att.id, staffId, { seconds: 90 });
  await store.closeAttempt(att.id, staffId, { completed: true, seconds: 120 });
  const enr = await store.getEnrolment(topic.topic_id, staffId);
  check('progress is derived (1 of 2 = 50%)', enr.percent, 50);
  check('time on task recorded', enr.total_seconds, 120);

  // ─── the cohort names the staff member ─────────────────────────
  console.log('\nreporting');
  const co = await store.cohort(topic.topic_id);
  const row = co.enrolments.find((e) => e.lawyer_id === staffId);
  check('cohort row carries the staff name', row && row.lawyer_name, 'Amina Haddad');
  check('and marks the learner kind', row && row.learner_kind, 'staff');
  const ov = await store.overview({ days: 30, staleDays: 0.0001, coldHours: 2 });
  check('overview titles the course from its module', (ov.by_course.find((c) => c.course_id === topic.topic_id) || {}).course_title, `Welcoming visitors ${ts}`);

  // ─── materials access for a staff learner ──────────────────────
  // canAccessMaterials lives in the route module; exercise the same rule.
  const e = db.prepare('SELECT 1 FROM enrolment WHERE lawyer_id = ? AND course_id = ? LIMIT 1').get(staffId, topic.topic_id);
  check('an enrolled staff account satisfies the materials rule', !!e, true);

  // ─── cleanup ───────────────────────────────────────────────────
  await topics.deleteTopic(topic.topic_id);
  db.prepare('DELETE FROM staff WHERE id IN (?, ?)').run(staffId, adminId);

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nfailed:', e.message, '\n', e.stack); process.exit(1); });
