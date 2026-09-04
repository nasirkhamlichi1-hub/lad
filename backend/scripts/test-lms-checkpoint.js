'use strict';

// Functional check for 056 — checkpoints, resume, the reaper and the
// org-wide overview. Companion to test-learning-spine.js and written in the
// same shape, against a throwaway course id.
//
// What it is really asserting: that progress banked mid-flight survives, and
// that banking it can never be used to claim a completion. The second half
// matters more than the first — a checkpoint is a client telling the server
// how far a learner has got, and a client must never be able to award itself
// a pass.
//
//   DATABASE_URL=./data/spine-test.sqlite node scripts/test-lms-checkpoint.js

const store = require('../src/lms/store');
const reaper = require('../src/lms/reaper');
const db = require('../src/lms/engine');

const COURSE = `test-ckpt-${Date.now()}`;
const ALICE = `test-ckpt-a-${Date.now()}`;
const BOB = `test-ckpt-b-${Date.now()}`;

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
  console.log('\nlms checkpoints — functional check\n');
  await cleanup();

  const mod = await store.upsertModule(COURSE, { title: 'Module', position: 0, gate: 'none' });
  const lesson = await store.upsertActivity(COURSE, {
    module_id: mod.id, kind: 'ai_lesson', title: 'Long lesson', position: 0, required: true,
  });
  const scorm = await store.upsertActivity(COURSE, {
    module_id: mod.id, kind: 'scorm', title: 'SCORM package', position: 1, required: true, pass_score: 70,
  });
  await store.ensureEnrolment(COURSE, ALICE, 'self');

  // ─── a sitting that never closes ───────────────────────────────
  console.log('mid-flight capture');
  const att = await store.startAttempt({ activityId: lesson.id, lawyerId: ALICE });
  check('attempt opens', att.status, 'open');

  let r = await store.checkpoint(att.id, ALICE, {
    resumeState: 'covered limitation periods up to s.14',
    seconds: 240,
    percent: 35,
  });
  check('checkpoint accepted', r.settled, false);
  check('percent banked', r.progress.percent, 35);
  check('seconds banked', r.progress.total_seconds, 240);
  check('resume point banked', r.progress.resume_state, 'covered limitation periods up to s.14');
  check('status still in progress', r.progress.status, 'in_progress');
  check('heartbeat recorded', !!r.attempt.heartbeat_at, true);

  // The learner keeps going, then the laptop shuts.
  r = await store.checkpoint(att.id, ALICE, { seconds: 500, percent: 60 });
  check('percent climbs', r.progress.percent, 60);
  check('seconds are replaced, not added', r.progress.total_seconds, 500);
  check('resume point survives a checkpoint that omits it', r.progress.resume_state, 'covered limitation periods up to s.14');

  // ─── a checkpoint cannot award a completion ────────────────────
  console.log('\ncheckpoints cannot settle');
  r = await store.checkpoint(att.id, ALICE, { percent: 100 });
  check('100% does not complete the activity', r.progress.status, 'in_progress');
  let enr = await store.getEnrolment(COURSE, ALICE);
  check('and does not move the course on', enr.required_done, 0);

  r = await store.checkpoint(att.id, ALICE, { percent: 20 });
  check('percent never goes backwards', r.progress.percent, 100);

  // ─── resume ────────────────────────────────────────────────────
  console.log('\nresume');
  let resume = await store.resumeFor(lesson.id, ALICE);
  check('resumable', resume.resumable, true);
  check('open attempt offered', resume.open_attempt.id, att.id);
  check('state carried', resume.resume_state, 'covered limitation periods up to s.14');

  const outline = await store.getOutline(COURSE, ALICE);
  const row = outline.sections[0].activities.find((a) => a.id === lesson.id);
  check('outline exposes resumable', row.progress.resumable, true);
  check('outline carries the state', row.progress.resume_state, 'covered limitation periods up to s.14');

  const fresh = outline.sections[0].activities.find((a) => a.id === scorm.id);
  check('untouched activity is not resumable', fresh.progress.resumable, false);

  // ─── the reaper ────────────────────────────────────────────────
  console.log('\nreaper');
  // Sweep with a zero-tolerance window so the attempt just opened counts as
  // silent. minutes is clamped to >= 1, so age the heartbeat instead.
  await db.run(
    "UPDATE activity_attempt SET heartbeat_at = '2020-01-01 00:00:00' WHERE id = ?", [att.id]
  );
  const swept = await reaper.sweep({ minutes: 60 });
  check('one attempt reaped', swept.reaped >= 1, true);

  const settled = await store.getAttempt(att.id);
  check('settled as abandoned', settled.status, 'abandoned');

  const after = await store.getProgress(lesson.id, ALICE);
  check('learner keeps their place', after.resume_state, 'covered limitation periods up to s.14');
  check('learner keeps their time', after.total_seconds, 500);
  check('and is still only in progress', after.status, 'in_progress');

  resume = await store.resumeFor(lesson.id, ALICE);
  check('still resumable after reaping', resume.resumable, true);
  check('no open attempt left dangling', resume.open_attempt, null);

  // ─── completion still works the old way ────────────────────────
  console.log('\ncompletion is still earned');
  const att2 = await store.startAttempt({ activityId: lesson.id, lawyerId: ALICE });
  await store.checkpoint(att2.id, ALICE, { seconds: 100, percent: 90 });
  await store.closeAttempt(att2.id, ALICE, { completed: true, seconds: 120 });
  const done = await store.getProgress(lesson.id, ALICE);
  check('closing completes it', done.status, 'completed');
  check('and pins it to 100', done.percent, 100);

  r = await store.checkpoint(att2.id, ALICE, { percent: 10 });
  check('checkpoint on a settled attempt is a no-op', r.settled, true);
  check('completed status unmoved', r.progress.status, 'completed');

  // ─── a completion arriving after the reaper settled the sitting ─
  // The case that loses a lawyer's work if closeAttempt treats 'abandoned'
  // as final: laptop sleeps, reaper settles, learner returns and marks it
  // done. That close must still count.
  console.log('\nfinishing after a reap');
  const late = await store.upsertActivity(COURSE, {
    module_id: mod.id, kind: 'document', title: 'Practice note', position: 2, required: true,
  });
  const lateAtt = await store.startAttempt({ activityId: late.id, lawyerId: ALICE });
  await store.checkpoint(lateAtt.id, ALICE, { seconds: 300, percent: 40 });
  await db.run("UPDATE activity_attempt SET heartbeat_at = '2020-01-01 00:00:00' WHERE id = ?", [lateAtt.id]);
  await reaper.sweep({ minutes: 60 });
  check('reaper settled it', (await store.getAttempt(lateAtt.id)).status, 'abandoned');

  const revived = await store.closeAttempt(lateAtt.id, ALICE, { completed: true, seconds: 400 });
  check('a genuine completion still lands', revived.status, 'completed');
  const lateProgress = await store.getProgress(late.id, ALICE);
  check('and the activity completes', lateProgress.status, 'completed');
  check('time is not lost', lateProgress.total_seconds, 400);
  check('re-abandoning stays a no-op',
    (await store.closeAttempt(lateAtt.id, ALICE, { completed: false, abandoned: true })).status, 'completed');

  // ─── malformed figures must not erase banked time ──────────────
  console.log('\nbad input cannot erase time');
  const junk = await store.startAttempt({ activityId: scorm.id, lawyerId: ALICE });
  await store.checkpoint(junk.id, ALICE, { seconds: 250 });
  check('time banked', (await store.getProgress(scorm.id, ALICE)).total_seconds, 250);
  await store.checkpoint(junk.id, ALICE, { seconds: 'oops' });
  check('a non-numeric heartbeat is ignored', (await store.getProgress(scorm.id, ALICE)).total_seconds, 250);
  await store.checkpoint(junk.id, ALICE, { seconds: -5 });
  check('a negative heartbeat is ignored', (await store.getProgress(scorm.id, ALICE)).total_seconds, 250);
  await store.closeAttempt(junk.id, ALICE, { completed: false, abandoned: true });

  // ─── an unfinished sitting is resumable even with no saved state ─
  // A document or a video has no position worth storing, so requiring
  // resume_state would mean those steps always read "Start".
  console.log('\nstarted-but-unfinished is resumable');
  const plain = await store.upsertActivity(COURSE, {
    module_id: mod.id, kind: 'video', title: 'Briefing recording', position: 3, required: false,
  });
  const plainAtt = await store.startAttempt({ activityId: plain.id, lawyerId: ALICE });
  await store.closeAttempt(plainAtt.id, ALICE, { completed: false, abandoned: true, seconds: 60 });
  const ol2 = await store.getOutline(COURSE, ALICE);
  const plainRow = ol2.sections[0].activities.find((a) => a.id === plain.id);
  check('no state, but still resumable', plainRow.progress.resumable, true);
  check('and carries no state to misread', plainRow.progress.resume_state, null);
  const doneRow = ol2.sections[0].activities.find((a) => a.id === late.id);
  check('a completed step is never resumable', doneRow.progress.resumable, false);

  // ─── the reaper's floor ────────────────────────────────────────
  console.log('\nreaper window floor');
  const live = await store.startAttempt({ activityId: plain.id, lawyerId: BOB });
  await store.checkpoint(live.id, BOB, { seconds: 10 });
  await reaper.sweep({ minutes: 1 });
  check('a 1-minute window cannot settle a live sitting',
    (await store.getAttempt(live.id)).status, 'open');
  await store.closeAttempt(live.id, BOB, { completed: false, abandoned: true });

  // ─── ownership ─────────────────────────────────────────────────
  console.log('\nownership');
  const att3 = await store.startAttempt({ activityId: scorm.id, lawyerId: ALICE });
  check('another learner cannot checkpoint it', await store.checkpoint(att3.id, BOB, { percent: 99 }), null);
  check('nor can they read the resume point', (await store.resumeFor(scorm.id, BOB)).resumable, false);

  // ─── overview ──────────────────────────────────────────────────
  console.log('\noverview');
  const ov = await store.overview({ days: 30, staleDays: 14, coldHours: 1 });
  check('headline present', typeof ov.headline.learners, 'number');
  check('counts this learner', ov.headline.learners >= 1, true);
  check('completion rate is a percentage', ov.headline.completion_rate >= 0 && ov.headline.completion_rate <= 100, true);
  check('course rollup includes the test course', ov.by_course.some((c) => c.course_id === COURSE), true);
  check('stall points listed', Array.isArray(ov.attention.stall_points), true);
  check('daily buckets returned', Array.isArray(ov.by_day), true);
  check('window echoed back', ov.window.days, 30);

  await cleanup();
  console.log(failures ? `\n✗ ${failures} check(s) failed\n` : '\n✓ all checks passed\n');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
