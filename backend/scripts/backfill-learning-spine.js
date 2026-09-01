'use strict';

// ─────────────────────────────────────────────────────────────────────
// Backfill the learning spine (migration 048) from what already exists.
// ─────────────────────────────────────────────────────────────────────
// Nothing is invented here. Every row written is derived from a record the
// platform already holds:
//
//   course_materials  → an activity per material (document / link / scorm)
//   trainer_lessons   → an activity per lesson that belongs to a course
//   trainer_sessions  → an attempt per past conversation (the evidence)
//   trainer_progress  → the aggregate, then enrolments recomputed from it
//
// Idempotent: rows are matched on their source id, so running it twice
// changes nothing. Safe to run on every deploy.
//
// Everything it creates is marked origin='imported', so a future content
// loader can rebuild its own rows without touching anything an admin
// authored by hand.
//
// Usage:
//   node scripts/backfill-learning-spine.js           # apply
//   node scripts/backfill-learning-spine.js --dry-run # report only

const db = require('../src/lms/engine');
const store = require('../src/lms/store');

const DRY = process.argv.includes('--dry-run');

const counts = {
  material_activities: 0,
  lesson_activities: 0,
  attempts: 0,
  progress: 0,
  enrolments: 0,
  recomputed: 0,
  skipped_existing: 0,
};

function say(...args) { console.log('[backfill]', ...args); }

async function tableExists(name) {
  const row = await db.one(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name]
  );
  return !!row;
}

// ─── 1. Course materials become activities ───────────────────────────
// kind='scorm' stays 'scorm' so that when the SCORM runtime lands these
// rows are already pointing at it. Until then they launch as a link, which
// is exactly what they do today — no behaviour changes.
async function backfillMaterials() {
  if (!(await tableExists('course_materials'))) return say('no course_materials table — skipping');

  const materials = await db.all(
    'SELECT * FROM course_materials ORDER BY course_id, created_at'
  );

  let position = 0;
  let lastCourse = null;

  for (const m of materials) {
    if (m.course_id !== lastCourse) { position = 0; lastCourse = m.course_id; }

    const existing = await db.one('SELECT id FROM activity WHERE material_id = ?', [m.id]);
    if (existing) { counts.skipped_existing++; position++; continue; }

    const kind = m.kind === 'scorm' ? 'scorm' : m.kind === 'link' ? 'link' : 'document';

    if (!DRY) {
      await store.upsertActivity(m.course_id, {
        kind,
        title: m.title || m.file_name || 'Course material',
        material_id: m.id,
        position: position,
        // Imported materials are optional by default. Making a historical
        // PDF suddenly required would drop every enrolled lawyer's
        // completion below 100% overnight for work they were never asked
        // to do. An admin marks the ones that matter.
        required: false,
        origin: 'imported',
      }, m.created_by || null);
    }
    counts.material_activities++;
    position++;
  }
}

// ─── 2. Trainer lessons become AI-lesson activities ──────────────────
async function backfillLessons() {
  if (!(await tableExists('trainer_lessons'))) return say('no trainer_lessons table — skipping');

  const lessons = await db.all(
    "SELECT * FROM trainer_lessons WHERE course_id IS NOT NULL AND course_id <> '' ORDER BY course_id, created_at"
  );

  for (const l of lessons) {
    const existing = await db.one('SELECT id FROM activity WHERE lesson_id = ?', [l.id]);
    if (existing) { counts.skipped_existing++; continue; }

    if (!DRY) {
      await store.upsertActivity(l.course_id, {
        kind: 'ai_lesson',
        title: l.title || 'AI training session',
        summary: l.summary || null,
        lesson_id: l.id,
        // A taught lesson IS the course, so unlike a downloadable it counts.
        required: true,
        cpd_minutes: Number(l.duration_min) || 0,
        published: l.active ? true : false,
        origin: 'imported',
      }, l.created_by_id || null);
    }
    counts.lesson_activities++;
  }
}

// ─── 3. Past conversations become attempts ───────────────────────────
// The attempt log is the evidence layer, so history goes in as attempts
// rather than as a bare aggregate. external_id keeps the link back to the
// original trainer_session and its transcript.
async function backfillSessions() {
  if (!(await tableExists('trainer_sessions'))) return say('no trainer_sessions table — skipping');

  const sessions = await db.all(
    `SELECT s.*, a.id AS activity_id, a.course_id AS course_id
     FROM trainer_sessions s
     JOIN activity a ON a.lesson_id = s.lesson_id
     WHERE s.lawyer_id IS NOT NULL
     ORDER BY s.started_at`
  );

  for (const s of sessions) {
    const existing = await db.one('SELECT id FROM activity_attempt WHERE external_id = ?', [s.id]);
    if (existing) { counts.skipped_existing++; continue; }

    const status = s.status === 'ended' ? 'completed' : s.status === 'active' ? 'abandoned' : 'abandoned';

    if (!DRY) {
      await db.run(
        `INSERT INTO activity_attempt
           (id, activity_id, lawyer_id, course_id, kind, status, seconds, external_id, detail, started_at, ended_at)
         VALUES (?, ?, ?, ?, 'ai_lesson', ?, ?, ?, ?, ?, ?)`,
        [
          db.genId('att'),
          s.activity_id,
          s.lawyer_id,
          s.course_id,
          status,
          Math.max(0, Number(s.seconds) || 0),
          s.id,
          db.toJson({ imported_from: 'trainer_sessions', engine: s.engine || null }),
          s.started_at || db.now(),
          s.ended_at || null,
        ]
      );
    }
    counts.attempts++;
  }
}

// ─── 4. Trainer progress becomes activity progress ───────────────────
// trainer_progress stays the AI trainer's own working record; this mirrors
// it onto the spine so a lawyer's course percentage accounts for the AI
// lessons they have already completed.
async function backfillProgress() {
  if (!(await tableExists('trainer_progress'))) return say('no trainer_progress table — skipping');

  const rows = await db.all(
    `SELECT p.*, a.id AS activity_id, a.course_id AS course_id
     FROM trainer_progress p
     JOIN activity a ON a.lesson_id = p.lesson_id`
  );

  const touched = new Set();

  for (const p of rows) {
    if (!DRY) {
      await store.ensureEnrolment(p.course_id, p.lawyer_id, 'import');

      const existing = await db.one(
        'SELECT id FROM activity_progress WHERE activity_id = ? AND lawyer_id = ?',
        [p.activity_id, p.lawyer_id]
      );

      const status = p.status === 'completed' ? 'completed' : 'in_progress';
      const percent = Math.max(0, Math.min(100, Number(p.percent_complete) || 0));

      if (existing) {
        counts.skipped_existing++;
      } else {
        await db.run(
          `INSERT INTO activity_progress
             (id, activity_id, lawyer_id, course_id, status, percent, total_seconds,
              attempt_count, resume_state, first_at, last_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            db.genId('apr'),
            p.activity_id,
            p.lawyer_id,
            p.course_id,
            status,
            status === 'completed' ? 100 : percent,
            Math.max(0, Number(p.total_seconds) || 0),
            Math.max(0, Number(p.session_count) || 0),
            p.resume_context || null,
            p.started_at || null,
            p.last_active_at || null,
            p.completed_at || null,
          ]
        );
        counts.progress++;
      }
    }
    touched.add(`${p.course_id}::${p.lawyer_id}`);
  }

  counts.enrolments = touched.size;

  if (!DRY) {
    for (const key of touched) {
      const [courseId, lawyerId] = key.split('::');
      await store.recompute(courseId, lawyerId);
      counts.recomputed++;
    }
  }
}

async function main() {
  say(DRY ? 'DRY RUN — nothing will be written' : 'applying');

  if (!(await tableExists('activity'))) {
    console.error('[backfill] the activity table does not exist — run `node scripts/migrate.js` first');
    process.exit(1);
  }

  await backfillMaterials();
  await backfillLessons();
  await backfillSessions();
  await backfillProgress();

  say('summary:');
  for (const [k, v] of Object.entries(counts)) say(`  ${k.padEnd(22)} ${v}`);
  say('done');
}

main().catch((e) => {
  console.error('[backfill] failed:', e.message);
  console.error(e.stack);
  process.exit(1);
});
