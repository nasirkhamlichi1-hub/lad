'use strict';

// ─────────────────────────────────────────────────────────────────────
// Seed a complete, working demo topic — for local testing.
// ─────────────────────────────────────────────────────────────────────
// Builds the journey the way an author would: composes a topic, attaches
// content to every slot, then publishes it. The result is something you
// can walk through end to end in the hub, and take apart in the builder.
//
//   npm run seed:demo-spine
//
// Everything it writes carries the DEMO- prefix and is cleared on each
// run, so it is repeatable and obvious in the database. Refuses to run
// with NODE_ENV=production.

const topics = require('../src/lms/topics');
const store = require('../src/lms/store');
const db = require('../src/lms/engine');
const legacy = require('../src/db');
const trainerStore = require('../src/services/trainerStore');
const jwt = require('../src/services/jwt');

const TOPIC = 'DEMO-CLPD-101';
const LAWYER = 'DEMO-LAWYER-1';
const ADMIN = 'DEMO-ADMIN-1';

async function wipe() {
  for (const sql of [
    'DELETE FROM activity_attempt WHERE course_id = ?',
    'DELETE FROM activity_progress WHERE course_id = ?',
    'DELETE FROM enrolment WHERE course_id = ?',
    'DELETE FROM activity WHERE course_id = ?',
    'DELETE FROM course_module WHERE course_id = ?',
  ]) await db.run(sql, [TOPIC]);
  legacy.prepare('DELETE FROM course_materials WHERE course_id = ?').run(TOPIC);
  legacy.prepare('DELETE FROM trainer_lessons WHERE course_id = ?').run(TOPIC);
}

function material(title, kind, url) {
  const id = `mat_demo_${Math.random().toString(16).slice(2, 10)}`;
  legacy.prepare(
    `INSERT INTO course_materials (id, course_id, title, kind, url, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, TOPIC, title, kind, url, ADMIN);
  return id;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[demo] refusing to run with NODE_ENV=production');
    process.exit(1);
  }

  await wipe();

  legacy.prepare(
    `INSERT INTO lawyers (id, first_name, last_name, email) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`
  ).run(LAWYER, 'Yousef', 'Al Mansouri', 'demo.lawyer@example.ae');

  // ─── Part 1: composed exactly as the builder composes it ─────────
  await topics.createTopic({
    topic_id: TOPIC,
    title: 'Suspicious transaction reporting',
    module_title: 'Part 1 — The duty to report',
    summary: 'What triggers a report, who owes the duty, and how quickly it has to be filed.',
    documents: 2,
    ai_bots: 1,
    scorms: 1,
    gate: 'sequential',
    pass_score: 80,
  }, ADMIN);

  // ─── Part 2: added to the same topic, in any order ───────────────
  await topics.addToTopic(TOPIC, {
    title: 'Suspicious transaction reporting',
    module_title: 'Part 2 — In practice',
    summary: 'Optional depth, taken in whatever order suits you.',
    documents: 1,
    ai_bots: 1,
    scorms: 0,
    gate: 'none',
  }, ADMIN);

  // ─── Attach content to every slot, in the order they appear ──────
  // Content is assigned by position so the journey reads sensibly:
  // Part 1's readings come before Part 1's taught session, and Part 2
  // picks up where it left off.
  const topic = await topics.getTopic(TOPIC);
  const ordered = topic.activities.slice().sort((a, b) => a.position - b.position);

  const readings = [
    ['Federal Decree-Law 20 of 2018 — extract', 'https://example.ae/decree-law-20.pdf'],
    ['FIU guidance: forming suspicion', 'https://example.ae/fiu-guidance.pdf'],
    ['Worked example: a flagged transfer', 'https://example.ae/case-study.pdf'],
  ];
  const teaching = [
    {
      title: 'When suspicion arises — taught session',
      body: 'Suspicion is a lower threshold than knowledge and lower than proof. It arises when a reasonable person, on the facts available, would think a transaction may involve the proceeds of crime. Once formed, the duty to report is personal to the lawyer and is not discharged by telling a compliance officer. A report must be filed with the Financial Intelligence Unit without delay; waiting for certainty is itself a breach.',
      objectives: ['Distinguish suspicion from knowledge', 'State when the duty crystallises', 'Explain why the duty is personal'],
    },
    {
      title: 'Tipping off — taught session',
      body: 'Once a report has been made, disclosing that fact to the client, or anything likely to prejudice an investigation, is a separate offence. The prohibition covers indirect disclosure — declining to act in a way that signals a report has been filed can itself amount to tipping off. Ordinary legal advice about the law is not tipping off; telling a client that they are under suspicion is.',
      objectives: ['Identify what counts as a disclosure', 'Separate lawful advice from tipping off'],
    },
  ];

  let readingN = 0, teachingN = 0;
  for (const a of ordered) {
    if (a.kind === 'document') {
      const [title, url] = readings[readingN++ % readings.length];
      await store.upsertActivity(TOPIC, { ...a, title, material_id: material(title, 'link', url) });
    } else if (a.kind === 'scorm') {
      const title = 'AML/CFT assessment (SCORM)';
      await store.upsertActivity(TOPIC, { ...a, title, material_id: material(title, 'scorm', 'https://example.ae/aml-package.zip') });
    } else if (a.kind === 'ai_lesson') {
      const t = teaching[teachingN++ % teaching.length];
      trainerStore.upsertLesson({
        id: a.lesson_id,
        title: t.title,
        summary: null,
        body: t.body,
        objectives: t.objectives,
        course_id: TOPIC,
        duration_min: 25,
        cpd_points: 2,
        active: false,
      }, ADMIN);
      await store.upsertActivity(TOPIC, { ...a, title: t.title });
    }
  }

  const pub = await topics.publishTopic(TOPIC);
  await store.ensureEnrolment(TOPIC, LAWYER, 'self');

  const final = await topics.getTopic(TOPIC);
  const enrolment = await store.getEnrolment(TOPIC, LAWYER);

  const tokens = {
    lawyer: jwt.sign({ sub: LAWYER, user_type: 'lawyer', role: 'lawyer', name: 'Yousef Al Mansouri' }),
    admin: jwt.sign({ sub: ADMIN, user_type: 'staff', role: 'lad_admin', name: 'Demo Administrator' }),
  };

  const fs = require('fs');
  const path = require('path');
  const out = path.join(__dirname, '..', 'playground', 'demo-session.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    token: tokens.lawyer, tokens, course_id: TOPIC, lawyer_id: LAWYER, admin_id: ADMIN,
  }, null, 2));

  const port = process.env.PORT || 4000;
  console.log('');
  console.log('  Demo topic ready');
  console.log('  ──────────────────────────────────────────────');
  console.log(`  topic       ${TOPIC} — ${final.title}`);
  console.log(`  parts       ${final.activities.length} across ${final.modules.length} sections (${pub.published} published)`);
  console.log(`  made of     ${final.counts.document} documents · ${final.counts.ai_lesson} AI bots · ${final.counts.scorm} SCORM`);
  console.log(`  required    ${enrolment.required_total}`);
  console.log('');
  console.log(`  Start here  http://localhost:${port}/playground`);
  console.log('');
}

main().catch((e) => { console.error('[demo] failed:', e.message); console.error(e.stack); process.exit(1); });
