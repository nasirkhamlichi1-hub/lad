'use strict';

// Functional check for topic authoring and the AI-trainer bridge.
//
//   DATABASE_URL=./data/test.sqlite node scripts/test-topics.js

const topics = require('../src/lms/topics');
const store = require('../src/lms/store');
const bridge = require('../src/lms/bridge');
const trainerStore = require('../src/services/trainerStore');
const db = require('../src/lms/engine');
const legacy = require('../src/db');

const TITLE = `Suspicious transactions ${Date.now().toString(36)}`;
const LAWYER = `test-lawyer-${Date.now()}`;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

async function main() {
  console.log('\ntopics + AI bridge — functional check\n');

  // ─── compose ───────────────────────────────────────────────────
  console.log('composing a topic');
  const topic = await topics.createTopic(
    { title: TITLE, scorms: 1, documents: 2, ai_bots: 1, gate: 'sequential', pass_score: 80 },
    'test-admin'
  );
  check('slots created', topic.activities.length, 4);
  check('counts as asked', topic.counts, { scorm: 1, document: 2, ai_lesson: 1 });
  check('nothing published yet', topic.published, 0);
  check('every slot reports what it needs', topic.outstanding, 4);
  check('reading comes before the assessment', topic.activities[0].kind, 'document');
  check('assessment last', topic.activities[3].kind, 'scorm');

  const aiSlot = topic.activities.find((a) => a.kind === 'ai_lesson');
  check('an AI slot has a real trainer lesson behind it', !!aiSlot.lesson_id, true);
  check('the bot is inactive until it has material', aiSlot.lesson.active, false);

  // ─── publishing is gated on readiness ──────────────────────────
  console.log('\npublishing gate');
  let pub = await topics.publishTopic(topic.topic_id);
  check('empty topic refuses to publish', pub.published, 0);
  check('and says exactly what is blocking it', pub.blocked.length, 4);

  // ─── attach content ────────────────────────────────────────────
  console.log('\nattaching content');
  const docs = topic.activities.filter((a) => a.kind === 'document');
  for (const d of docs) {
    const matId = `mat_${Math.random().toString(16).slice(2, 10)}`;
    legacy.prepare(
      "INSERT INTO course_materials (id, course_id, title, kind, url, created_at) VALUES (?,?,?,?,?,datetime('now'))"
    ).run(matId, topic.topic_id, d.title, 'link', 'https://example.ae/guidance.pdf');
    await store.upsertActivity(topic.topic_id, { ...d, material_id: matId });
  }

  const scorm = topic.activities.find((a) => a.kind === 'scorm');
  const scormMat = `mat_${Math.random().toString(16).slice(2, 10)}`;
  legacy.prepare(
    "INSERT INTO course_materials (id, course_id, title, kind, url, created_at) VALUES (?,?,?,?,?,datetime('now'))"
  ).run(scormMat, topic.topic_id, scorm.title, 'scorm', 'https://example.ae/aml.zip');
  await store.upsertActivity(topic.topic_id, { ...scorm, material_id: scormMat });

  trainerStore.upsertLesson({
    id: aiSlot.lesson_id,
    title: aiSlot.title,
    body: 'A suspicious transaction report must be filed with the FIU without delay once suspicion is formed. The duty is personal and cannot be delegated to a compliance function alone.',
    objectives: ['Identify when suspicion arises', 'State the reporting deadline'],
    course_id: topic.topic_id,
    duration_min: 30,
    cpd_points: 2,
    active: false,
  }, 'test-admin');

  const ready = await topics.getTopic(topic.topic_id);
  check('every slot now ready', ready.outstanding, 0);

  pub = await topics.publishTopic(topic.topic_id);
  check('publishes all four', pub.published, 4);

  const live = await topics.getTopic(topic.topic_id);
  check('bot activated on publish', live.activities.find((a) => a.kind === 'ai_lesson').lesson.active, true);

  // ─── the learner's view ────────────────────────────────────────
  console.log('\nthe hub');
  await store.ensureEnrolment(topic.topic_id, LAWYER, 'self');
  let outline = await store.getOutline(topic.topic_id, LAWYER);
  check('one section', outline.sections.length, 1);
  check('four activities visible', outline.sections[0].activities.length, 4);
  check('sequential: only the first is open', outline.sections[0].activities.map((a) => a.locked), [false, true, true, true]);
  check('enrolment counts all four as required', outline.enrolment.required_total, 4);

  // ─── the AI bridge ─────────────────────────────────────────────
  console.log('\nAI trainer bridge');
  // Clear the two readings so the AI session is reachable.
  for (const d of docs) {
    const att = await store.startAttempt({ activityId: d.id, lawyerId: LAWYER });
    await store.closeAttempt(att.id, LAWYER, { completed: true, seconds: 200 });
  }

  // A trainer session, closed exactly as routes/trainer.js closes one.
  const session = trainerStore.createSession({
    lessonId: aiSlot.lesson_id, lawyerId: LAWYER, status: 'active', engine: 'browser',
  });
  await bridge.recordTrainerSession({
    sessionId: session.id, lessonId: aiSlot.lesson_id, lawyerId: LAWYER,
    seconds: 1500, mode: 'ended',
  });

  const aiProgress = await store.getProgress(aiSlot.id, LAWYER);
  check('an AI session lands on the spine', aiProgress.status, 'completed');
  check('with its duration', aiProgress.total_seconds, 1500);

  const attempts = (await store.learnerReport(LAWYER)).attempts;
  const mirrored = attempts.find((a) => a.external_id === session.id);
  check('traceable back to the trainer session', !!mirrored, true);

  // Idempotency — the trainer retries closes on flaky connections.
  await bridge.recordTrainerSession({
    sessionId: session.id, lessonId: aiSlot.lesson_id, lawyerId: LAWYER, seconds: 1500, mode: 'ended',
  });
  const after = await store.getProgress(aiSlot.id, LAWYER);
  check('a retried close is not counted twice', after.total_seconds, 1500);

  const enr = await store.getEnrolment(topic.topic_id, LAWYER);
  check('three of four done', enr.required_done, 3);
  check('course at 75%', enr.percent, 75);

  // A paused session should not complete the activity.
  const s2 = trainerStore.createSession({ lessonId: aiSlot.lesson_id, lawyerId: LAWYER, status: 'active', engine: 'browser' });
  await bridge.recordTrainerSession({ sessionId: s2.id, lessonId: aiSlot.lesson_id, lawyerId: LAWYER, seconds: 300, mode: 'paused' });
  const stillDone = await store.getProgress(aiSlot.id, LAWYER);
  check('a later pause cannot undo a completion', stillDone.status, 'completed');


  // ─── sequencing ────────────────────────────────────────────────
  console.log('\nsequencing');
  const seqTitle = `Mixed ${Date.now().toString(36)}`;
  const kinds = (t) => t.activities.slice().sort((a, b) => a.position - b.position).map((a) => a.kind);

  let seq = await topics.createTopic({
    title: seqTitle,
    steps: [{ kind: 'ai' }, { kind: 'scorm' }, { kind: 'ai' }, { kind: 'ai' }, { kind: 'material' }, { kind: 'scorm' }],
  }, 'test-admin');
  check('an arbitrary order is kept', kinds(seq),
    ['ai_lesson', 'scorm', 'ai_lesson', 'ai_lesson', 'document', 'scorm']);
  check('positions are dense', seq.activities.map((a) => a.position).sort((x, y) => x - y), [0, 1, 2, 3, 4, 5]);

  const bulk = await topics.createTopic({ title: `Bulk ${Date.now().toString(36)}`, steps: [{ kind: 'scorm', count: 10 }] }, 'test-admin');
  check('ten packages in one gesture', bulk.activities.length, 10);
  check('all of them SCORM', bulk.activities.every((a) => a.kind === 'scorm'), true);

  seq = await topics.insertSteps(seq.topic_id, { kind: 'material', at: 1 }, 'test-admin');
  check('insert lands at the index', kinds(seq)[1], 'document');
  check('and pushes the rest down', kinds(seq).length, 7);

  const ord = seq.activities.slice().sort((a, b) => a.position - b.position);
  seq = await topics.moveStep(seq.topic_id, ord[ord.length - 1].id, 0);
  check('a step can move to the front', kinds(seq)[0], 'scorm');

  const ord2 = seq.activities.slice().sort((a, b) => a.position - b.position);
  const removed = await topics.removeStep(seq.topic_id, ord2[2].id);
  check('an untouched draft is deleted outright', removed.mode, 'deleted');
  check('and the sequence closes up', removed.topic.activities.map((a) => a.position).sort((x, y) => x - y), [0, 1, 2, 3, 4, 5]);

  // A step with attempts against it is evidence — retire, never delete.
  const keep = removed.topic.activities.slice().sort((a, b) => a.position - b.position)[0];
  await store.upsertActivity(seq.topic_id, { ...keep, published: true });
  const ka = await store.startAttempt({ activityId: keep.id, lawyerId: LAWYER });
  await store.closeAttempt(ka.id, LAWYER, { completed: true, seconds: 60 });
  const retired = await topics.removeStep(seq.topic_id, keep.id);
  check('a step with attempts is retired instead', retired.mode, 'retired');

  for (const id of [seq.topic_id, bulk.topic_id]) {
    for (const sql of [
      'DELETE FROM activity_attempt WHERE course_id = ?',
      'DELETE FROM activity_progress WHERE course_id = ?',
      'DELETE FROM enrolment WHERE course_id = ?',
      'DELETE FROM activity WHERE course_id = ?',
      'DELETE FROM course_module WHERE course_id = ?',
    ]) await db.run(sql, [id]);
  }

  // ─── cleanup ───────────────────────────────────────────────────
  for (const sql of [
    'DELETE FROM activity_attempt WHERE course_id = ?',
    'DELETE FROM activity_progress WHERE course_id = ?',
    'DELETE FROM enrolment WHERE course_id = ?',
    'DELETE FROM activity WHERE course_id = ?',
    'DELETE FROM course_module WHERE course_id = ?',
  ]) await db.run(sql, [topic.topic_id]);

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nfailed:', e.message, '\n', e.stack); process.exit(1); });
