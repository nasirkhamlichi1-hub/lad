'use strict';

// Functional check for the learning spine. Runs against whatever database
// DATABASE_URL points at, using a throwaway course id, and asserts the
// behaviour the spine actually promises — above all that completion and
// percentages are derived from attempts and cannot drift.
//
//   DATABASE_URL=./data/spine-test.sqlite node scripts/test-learning-spine.js

const store = require('../src/lms/store');
const db = require('../src/lms/engine');

const COURSE = `test-course-${Date.now()}`;
const ALICE = `test-lawyer-a-${Date.now()}`;
const BOB = `test-lawyer-b-${Date.now()}`;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

async function cleanup() {
  for (const sql of [
    'DELETE FROM activity_attempt WHERE course_id = ?',
    'DELETE FROM activity_progress WHERE course_id = ?',
    'DELETE FROM enrolment WHERE course_id = ?',
    'DELETE FROM activity WHERE course_id = ?',
    'DELETE FROM course_module WHERE course_id = ?',
  ]) await db.run(sql, [COURSE]);
}

async function main() {
  console.log('\nlearning spine — functional check\n');
  await cleanup();

  // ─── structure ─────────────────────────────────────────────────
  console.log('structure');
  const mod = await store.upsertModule(COURSE, { title: 'Part 1 — Procedure', position: 0, gate: 'sequential' });
  check('module created', !!mod.id, true);

  const reading = await store.upsertActivity(COURSE, {
    module_id: mod.id, kind: 'document', title: 'Practice direction', position: 0, required: true,
  });
  const lesson = await store.upsertActivity(COURSE, {
    module_id: mod.id, kind: 'ai_lesson', title: 'Limitation periods', position: 1, required: true, pass_score: 70,
  });
  const optional = await store.upsertActivity(COURSE, {
    module_id: mod.id, kind: 'link', title: 'Further reading', position: 2, required: false,
  });
  check('three activities', (await store.listActivities(COURSE)).length, 3);

  // ─── enrolment starts empty ────────────────────────────────────
  console.log('\nenrolment');
  await store.ensureEnrolment(COURSE, ALICE, 'self');
  let enr = await store.getEnrolment(COURSE, ALICE);
  check('required_total counts only required+published', enr.required_total, 2);
  check('starts at 0%', enr.percent, 0);

  // ─── gating ────────────────────────────────────────────────────
  console.log('\ngating');
  let outline = await store.getOutline(COURSE, ALICE);
  const acts = outline.sections[0].activities;
  check('first activity open', acts[0].locked, false);
  check('second locked behind it', acts[1].locked, true);

  // ─── an attempt that completes ─────────────────────────────────
  console.log('\nattempts');
  let a1 = await store.startAttempt({ activityId: reading.id, lawyerId: ALICE });
  check('attempt opens', a1.status, 'open');
  let p = await store.getProgress(reading.id, ALICE);
  check('starting counts as in_progress', p.status, 'in_progress');

  await store.closeAttempt(a1.id, ALICE, { completed: true, seconds: 300 });
  p = await store.getProgress(reading.id, ALICE);
  check('completes with no pass_score', p.status, 'completed');
  check('percent forced to 100 when done', p.percent, 100);
  check('seconds recorded', p.total_seconds, 300);

  enr = await store.getEnrolment(COURSE, ALICE);
  check('enrolment now 50%', enr.percent, 50);
  check('required_done = 1', enr.required_done, 1);

  outline = await store.getOutline(COURSE, ALICE);
  check('gate released', outline.sections[0].activities[1].locked, false);

  // ─── scored activity: fail then pass ───────────────────────────
  console.log('\nscoring');
  const a2 = await store.startAttempt({ activityId: lesson.id, lawyerId: ALICE });
  await store.closeAttempt(a2.id, ALICE, { completed: true, score: 55, seconds: 600 });
  p = await store.getProgress(lesson.id, ALICE);
  check('below pass_score = failed', p.status, 'failed');
  enr = await store.getEnrolment(COURSE, ALICE);
  check('a fail does not complete the course', enr.percent, 50);

  const a3 = await store.startAttempt({ activityId: lesson.id, lawyerId: ALICE });
  await store.closeAttempt(a3.id, ALICE, { completed: true, score: 82, seconds: 400 });
  p = await store.getProgress(lesson.id, ALICE);
  check('above pass_score = passed', p.status, 'passed');
  check('best score kept, not last', p.score, 82);
  check('seconds accumulate across attempts', p.total_seconds, 1000);
  check('attempt count', p.attempt_count, 2);

  enr = await store.getEnrolment(COURSE, ALICE);
  check('course now 100%', enr.percent, 100);
  check('marked completed', enr.status, 'completed');
  check('optional activity never held it open', enr.required_total, 2);

  // ─── idempotency ───────────────────────────────────────────────
  console.log('\nidempotency');
  const before = await store.getProgress(lesson.id, ALICE);
  await store.closeAttempt(a3.id, ALICE, { completed: true, score: 99, seconds: 9999 });
  const after = await store.getProgress(lesson.id, ALICE);
  check('re-closing a settled attempt changes nothing', after.total_seconds, before.total_seconds);
  check('and cannot inflate the score', after.score, 82);

  // ─── structural change re-derives ──────────────────────────────
  console.log('\nderivation');
  await store.upsertActivity(COURSE, { id: optional.id, module_id: mod.id, kind: 'link', title: 'Further reading', position: 2, required: true });
  enr = await store.getEnrolment(COURSE, ALICE);
  check('making an activity required reopens the course', enr.percent, 67);
  check('status back to active', enr.status, 'active');

  await store.retireActivity(optional.id);
  enr = await store.getEnrolment(COURSE, ALICE);
  check('retiring it releases the learner again', enr.percent, 100);

  const retired = await store.getActivity(optional.id);
  check('retired, not deleted', retired.published, false);

  // ─── isolation between learners ────────────────────────────────
  console.log('\nisolation');
  await store.ensureEnrolment(COURSE, BOB, 'self');
  const bobEnr = await store.getEnrolment(COURSE, BOB);
  check('a second learner starts clean', bobEnr.percent, 0);
  const bobProgress = await store.getProgress(reading.id, BOB);
  check('no progress leaks across learners', bobProgress, null);

  // ─── another learner cannot close your attempt ─────────────────
  const a4 = await store.startAttempt({ activityId: reading.id, lawyerId: BOB });
  const stolen = await store.closeAttempt(a4.id, ALICE, { completed: true });
  check('an attempt can only be closed by its owner', stolen, null);

  // ─── reporting ─────────────────────────────────────────────────
  console.log('\nreporting');
  const report = await store.learnerReport(ALICE);
  check('report carries the attempt evidence', report.attempts.length >= 3, true);
  check('report covers the enrolment', report.enrolments.length, 1);

  const co = await store.cohort(COURSE);
  check('cohort sees both learners', co.enrolments.length, 2);
  check('stall list covers required activities', co.stalls.length, 2);

  await cleanup();

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nfailed:', e.message, '\n', e.stack); process.exit(1); });
