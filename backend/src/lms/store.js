'use strict';

// ─────────────────────────────────────────────────────────────────────
// The learning spine — repository layer.
// ─────────────────────────────────────────────────────────────────────
// Course structure (modules + activities), enrolment, per-activity
// progress, and the append-only attempt log. Route handlers see plain
// objects; every timestamp, JSON column and 0/1 flag is converted here.
//
// The one rule worth stating up front: `enrolment.percent` and
// `activity_progress.status` are DERIVED. No function in this module lets
// a caller set them directly. They are recomputed from attempts whenever
// one settles, so any number shown to a lawyer, a firm or a regulator can
// be rebuilt from the evidence rows underneath it.

const db = require('./engine');

const KINDS = ['ai_lesson', 'scorm', 'document', 'link', 'video', 'assessment'];
const ORIGINS = ['authored', 'imported', 'derived'];

function clampPercent(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function clampScore(n) {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

// ─── Hydration ───────────────────────────────────────────────────────

function hydrateModule(row) {
  if (!row) return null;
  return { ...row, published: !!row.published };
}

function hydrateActivity(row) {
  if (!row) return null;
  return {
    ...row,
    required: !!row.required,
    published: !!row.published,
    pass_score: row.pass_score === null ? null : Number(row.pass_score),
  };
}

function hydrateProgress(row) {
  if (!row) return null;
  return { ...row, score: row.score === null ? null : Number(row.score) };
}

function hydrateAttempt(row) {
  if (!row) return null;
  return {
    ...row,
    score: row.score === null ? null : Number(row.score),
    detail: db.fromJson(row.detail, null),
  };
}

// ─── Modules ─────────────────────────────────────────────────────────

async function listModules(courseId) {
  const rows = await db.all(
    'SELECT * FROM course_module WHERE course_id = ? ORDER BY position, title',
    [courseId]
  );
  return rows.map(hydrateModule);
}

async function upsertModule(courseId, input = {}) {
  const id = input.id || db.genId('mod');
  const ts = db.now();
  await db.run(
    `INSERT INTO course_module (id, course_id, title, summary, welcome, position, gate, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title,
       summary = excluded.summary,
       welcome = excluded.welcome,
       position = excluded.position,
       gate = excluded.gate,
       published = excluded.published,
       updated_at = excluded.updated_at`,
    [
      id,
      courseId,
      String(input.title || 'Untitled section').slice(0, 200),
      input.summary || null,
      input.welcome === undefined ? null : (input.welcome || null),
      Number(input.position) || 0,
      input.gate === 'sequential' ? 'sequential' : 'none',
      input.published === false ? 0 : 1,
      ts,
      ts,
    ]
  );
  return hydrateModule(await db.one('SELECT * FROM course_module WHERE id = ?', [id]));
}

// Deleting a section does not delete its teaching. Activities are detached
// to the course root so that removing a heading can never silently destroy
// a lawyer's progress against the material under it.
async function deleteModule(id) {
  return db.tx(async (t) => {
    await t.run('UPDATE activity SET module_id = NULL WHERE module_id = ?', [id]);
    const r = await t.run('DELETE FROM course_module WHERE id = ?', [id]);
    return r.changes > 0;
  });
}

// ─── Activities ──────────────────────────────────────────────────────

async function listActivities(courseId, { includeUnpublished = false } = {}) {
  const rows = await db.all(
    `SELECT * FROM activity
     WHERE course_id = ? ${includeUnpublished ? '' : 'AND published = 1'}
     ORDER BY position, title`,
    [courseId]
  );
  return rows.map(hydrateActivity);
}

async function getActivity(id) {
  return hydrateActivity(await db.one('SELECT * FROM activity WHERE id = ?', [id]));
}

async function upsertActivity(courseId, input = {}, userId = null) {
  const kind = KINDS.includes(input.kind) ? input.kind : 'document';
  const origin = ORIGINS.includes(input.origin) ? input.origin : 'authored';
  const id = input.id || db.genId('act');
  const ts = db.now();

  await db.run(
    `INSERT INTO activity
       (id, course_id, module_id, kind, title, summary, position, required, weight,
        cpd_minutes, pass_score, lesson_id, material_id, package_id, origin,
        published, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       module_id = excluded.module_id,
       kind = excluded.kind,
       title = excluded.title,
       summary = excluded.summary,
       position = excluded.position,
       required = excluded.required,
       weight = excluded.weight,
       cpd_minutes = excluded.cpd_minutes,
       pass_score = excluded.pass_score,
       lesson_id = excluded.lesson_id,
       material_id = excluded.material_id,
       package_id = excluded.package_id,
       published = excluded.published,
       updated_at = excluded.updated_at`,
    [
      id,
      courseId,
      input.module_id || null,
      kind,
      String(input.title || 'Untitled activity').slice(0, 300),
      input.summary || null,
      Number(input.position) || 0,
      input.required === false ? 0 : 1,
      Math.max(1, Number(input.weight) || 1),
      Math.max(0, Number(input.cpd_minutes) || 0),
      clampScore(input.pass_score),
      input.lesson_id || null,
      input.material_id || null,
      input.package_id || null,
      origin,
      input.published === false ? 0 : 1,
      userId,
      ts,
      ts,
    ]
  );

  // Structure changed, so every enrolment's denominator may have changed
  // with it. Recompute rather than let a stale percentage stand.
  await recomputeCourse(courseId);
  return getActivity(id);
}

// Attempts are evidence and are never destroyed. Removing an activity from
// a course unpublishes it instead, so the record of what a lawyer did
// survives a syllabus change — which is exactly what an audit needs.
async function retireActivity(id) {
  const activity = await getActivity(id);
  if (!activity) return null;
  await db.run('UPDATE activity SET published = 0, updated_at = ? WHERE id = ?', [db.now(), id]);
  await recomputeCourse(activity.course_id);
  return getActivity(id);
}

async function reorderActivities(courseId, orderedIds = []) {
  return db.tx(async (t) => {
    const ts = db.now();
    for (let i = 0; i < orderedIds.length; i++) {
      await t.run(
        'UPDATE activity SET position = ?, updated_at = ? WHERE id = ? AND course_id = ?',
        [i, ts, orderedIds[i], courseId]
      );
    }
    return orderedIds.length;
  });
}

// ─── Enrolment ───────────────────────────────────────────────────────

async function getEnrolment(courseId, lawyerId) {
  return db.one('SELECT * FROM enrolment WHERE course_id = ? AND lawyer_id = ?', [courseId, lawyerId]);
}

async function ensureEnrolment(courseId, lawyerId, source = 'self') {
  const existing = await getEnrolment(courseId, lawyerId);
  if (existing) return existing;
  const ts = db.now();
  await db.run(
    `INSERT INTO enrolment (id, course_id, lawyer_id, source, status, created_at, started_at, last_active_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT (course_id, lawyer_id) DO NOTHING`,
    [db.genId('enr'), courseId, lawyerId, source, ts, ts, ts]
  );
  await recompute(courseId, lawyerId);
  return getEnrolment(courseId, lawyerId);
}

async function listEnrolmentsForLawyer(lawyerId) {
  return db.all(
    'SELECT * FROM enrolment WHERE lawyer_id = ? ORDER BY last_active_at DESC',
    [lawyerId]
  );
}

// ─── Progress ────────────────────────────────────────────────────────

async function getProgress(activityId, lawyerId) {
  return hydrateProgress(
    await db.one('SELECT * FROM activity_progress WHERE activity_id = ? AND lawyer_id = ?', [activityId, lawyerId])
  );
}

async function listProgressForCourse(courseId, lawyerId) {
  const rows = await db.all(
    'SELECT * FROM activity_progress WHERE course_id = ? AND lawyer_id = ?',
    [courseId, lawyerId]
  );
  return rows.map(hydrateProgress);
}

// Decide an activity's status from what the learner did and what the
// activity demands. Kept in one place because "did they finish it" is the
// question the whole system is built to answer, and it must mean the same
// thing for a SCORM package as for an AI conversation.
function settleStatus(activity, { completed, score }) {
  if (!completed) return 'in_progress';
  if (activity.pass_score === null || activity.pass_score === undefined) return 'completed';
  if (score === null || score === undefined) return 'completed';
  return score >= activity.pass_score ? 'passed' : 'failed';
}

function countsAsDone(status) {
  return status === 'completed' || status === 'passed';
}

// ─── Attempts ────────────────────────────────────────────────────────

async function startAttempt({ activityId, lawyerId, externalId = null, detail = null }) {
  const activity = await getActivity(activityId);
  if (!activity) return null;

  await ensureEnrolment(activity.course_id, lawyerId, 'self');

  const id = db.genId('att');
  const ts = db.now();
  await db.run(
    `INSERT INTO activity_attempt
       (id, activity_id, lawyer_id, course_id, kind, status, external_id, detail, started_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [id, activityId, lawyerId, activity.course_id, activity.kind, externalId, db.toJson(detail), ts]
  );

  // Opening an attempt is itself progress — a learner who starts and
  // abandons should not read as "not started".
  await db.run(
    `INSERT INTO activity_progress
       (id, activity_id, lawyer_id, course_id, status, attempt_count, first_at, last_at)
     VALUES (?, ?, ?, ?, 'in_progress', 1, ?, ?)
     ON CONFLICT (activity_id, lawyer_id) DO UPDATE SET
       status = CASE WHEN activity_progress.status IN ('completed','passed')
                     THEN activity_progress.status ELSE 'in_progress' END,
       attempt_count = activity_progress.attempt_count + 1,
       last_at = excluded.last_at`,
    [db.genId('apr'), activityId, lawyerId, activity.course_id, ts, ts]
  );

  await touchEnrolment(activity.course_id, lawyerId);
  return hydrateAttempt(await db.one('SELECT * FROM activity_attempt WHERE id = ?', [id]));
}

async function getAttempt(id) {
  return hydrateAttempt(await db.one('SELECT * FROM activity_attempt WHERE id = ?', [id]));
}

// Close out a sitting and settle everything that depends on it. The
// attempt row is written once and never touched again; the aggregate and
// the enrolment percentage are recomputed from scratch rather than
// incremented, so a duplicate or out-of-order close cannot drift them.
async function closeAttempt(attemptId, lawyerId, {
  completed = true,
  score = null,
  seconds = 0,
  percent = null,
  detail = null,
  resumeState = null,
  abandoned = false,
} = {}) {
  const attempt = await getAttempt(attemptId);
  if (!attempt) return null;
  if (attempt.lawyer_id !== lawyerId) return null;
  if (attempt.status !== 'open') return attempt; // already settled — idempotent

  const activity = await getActivity(attempt.activity_id);
  if (!activity) return null;

  const cleanSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const cleanScore = clampScore(score);
  const status = abandoned ? 'in_progress' : settleStatus(activity, { completed, score: cleanScore });
  const ts = db.now();

  await db.tx(async (t) => {
    await t.run(
      `UPDATE activity_attempt
       SET status = ?, score = ?, seconds = ?, detail = ?, ended_at = ?
       WHERE id = ?`,
      [abandoned ? 'abandoned' : 'completed', cleanScore, cleanSeconds, db.toJson(detail), ts, attemptId]
    );

    // Rebuild the aggregate from the attempt log rather than adding to it.
    // `ever_completed` is what makes a fail-then-pass sequence settle
    // correctly: the activity is judged on the best evidence across every
    // sitting, not on whichever one happened to close last.
    const roll = await t.one(
      `SELECT COUNT(*) AS attempts,
              COALESCE(SUM(seconds), 0) AS seconds,
              MAX(score) AS best_score,
              MIN(started_at) AS first_at,
              MAX(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS ever_completed
       FROM activity_attempt
       WHERE activity_id = ? AND lawyer_id = ?`,
      [attempt.activity_id, lawyerId]
    );

    const bestScore = clampScore(roll && roll.best_score);
    const everCompleted = !!(roll && Number(roll.ever_completed));
    const finalStatus = settleStatus(activity, { completed: everCompleted, score: bestScore });

    const finalPercent = percent === null
      ? (countsAsDone(finalStatus) ? 100 : clampPercent((await currentPercent(t, attempt.activity_id, lawyerId))))
      : clampPercent(percent);

    await t.run(
      `UPDATE activity_progress
       SET status = ?, percent = ?, score = ?, total_seconds = ?, attempt_count = ?,
           resume_state = COALESCE(?, resume_state),
           first_at = COALESCE(first_at, ?),
           last_at = ?,
           completed_at = CASE WHEN ? IN ('completed','passed') AND completed_at IS NULL THEN ? ELSE completed_at END
       WHERE activity_id = ? AND lawyer_id = ?`,
      [
        finalStatus,
        countsAsDone(finalStatus) ? 100 : finalPercent,
        bestScore,
        roll ? Number(roll.seconds) || 0 : cleanSeconds,
        roll ? Number(roll.attempts) || 1 : 1,
        resumeState,
        roll ? roll.first_at : ts,
        ts,
        finalStatus,
        ts,
        attempt.activity_id,
        lawyerId,
      ]
    );
  });

  await recompute(activity.course_id, lawyerId);
  return getAttempt(attemptId);
}

async function currentPercent(t, activityId, lawyerId) {
  const row = await t.one(
    'SELECT percent FROM activity_progress WHERE activity_id = ? AND lawyer_id = ?',
    [activityId, lawyerId]
  );
  return row ? row.percent : 0;
}

// ─── Derivation ──────────────────────────────────────────────────────

async function touchEnrolment(courseId, lawyerId) {
  await db.run(
    'UPDATE enrolment SET last_active_at = ? WHERE course_id = ? AND lawyer_id = ?',
    [db.now(), courseId, lawyerId]
  );
}

// The single writer of enrolment.percent. Counts only activities that are
// both required and published, so unpublishing a retired activity releases
// the lawyers who never did it instead of holding their course open for ever.
async function recompute(courseId, lawyerId) {
  const totals = await db.one(
    `SELECT COUNT(*) AS required_total,
            SUM(CASE WHEN p.status IN ('completed','passed') THEN 1 ELSE 0 END) AS required_done
     FROM activity a
     LEFT JOIN activity_progress p
            ON p.activity_id = a.id AND p.lawyer_id = ?
     WHERE a.course_id = ? AND a.required = 1 AND a.published = 1`,
    [lawyerId, courseId]
  );

  const seconds = await db.one(
    'SELECT COALESCE(SUM(total_seconds), 0) AS s FROM activity_progress WHERE course_id = ? AND lawyer_id = ?',
    [courseId, lawyerId]
  );

  const total = totals ? Number(totals.required_total) || 0 : 0;
  const done = totals ? Number(totals.required_done) || 0 : 0;
  const percent = total === 0 ? 0 : clampPercent((done / total) * 100);
  const complete = total > 0 && done >= total;
  const ts = db.now();

  await db.run(
    `UPDATE enrolment
     SET required_total = ?, required_done = ?, percent = ?, total_seconds = ?,
         status = CASE WHEN ? = 1 THEN 'completed'
                       WHEN status = 'withdrawn' THEN 'withdrawn'
                       ELSE 'active' END,
         completed_at = CASE WHEN ? = 1 AND completed_at IS NULL THEN ? ELSE completed_at END,
         last_active_at = ?
     WHERE course_id = ? AND lawyer_id = ?`,
    [total, done, percent, seconds ? Number(seconds.s) || 0 : 0,
     complete ? 1 : 0, complete ? 1 : 0, ts, ts, courseId, lawyerId]
  );

  return getEnrolment(courseId, lawyerId);
}

// After a structural change, every enrolled lawyer's denominator moves.
async function recomputeCourse(courseId) {
  const rows = await db.all('SELECT lawyer_id FROM enrolment WHERE course_id = ?', [courseId]);
  for (const r of rows) await recompute(courseId, r.lawyer_id);
  return rows.length;
}

// ─── Reading a course ────────────────────────────────────────────────

// The learner-facing shape: sections in order, activities in order, each
// carrying this lawyer's own state. Activities with no module fall into a
// trailing implicit section so a course that never used modules still reads
// as a course.
async function getOutline(courseId, lawyerId = null, { includeUnpublished = false } = {}) {
  const [modules, activities] = await Promise.all([
    listModules(courseId),
    listActivities(courseId, { includeUnpublished }),
  ]);

  const progressByActivity = new Map();
  if (lawyerId) {
    for (const p of await listProgressForCourse(courseId, lawyerId)) {
      progressByActivity.set(p.activity_id, p);
    }
  }

  const decorate = (a) => {
    const p = progressByActivity.get(a.id) || null;
    return {
      ...a,
      progress: p
        ? {
            status: p.status,
            percent: p.percent,
            score: p.score,
            total_seconds: p.total_seconds,
            attempt_count: p.attempt_count,
            last_at: p.last_at,
            completed_at: p.completed_at,
          }
        : { status: 'not_started', percent: 0, score: null, total_seconds: 0, attempt_count: 0 },
    };
  };

  const sections = modules.map((m) => ({
    ...m,
    activities: activities.filter((a) => a.module_id === m.id).map(decorate),
  }));

  const loose = activities.filter((a) => !a.module_id).map(decorate);
  if (loose.length) {
    sections.push({
      id: null,
      course_id: courseId,
      title: sections.length ? 'Further material' : 'Course material',
      summary: null,
      position: 9999,
      gate: 'none',
      published: true,
      activities: loose,
    });
  }

  // Sequential gating is resolved here, not in the client: whether an item
  // is open is an access decision and belongs on the server.
  for (const section of sections) {
    let blocked = false;
    for (const a of section.activities) {
      a.locked = blocked;
      if (section.gate === 'sequential' && a.required && !countsAsDone(a.progress.status)) blocked = true;
    }
  }

  const enrolment = lawyerId ? await getEnrolment(courseId, lawyerId) : null;

  // A section whose activities are all still unpublished is noise to a
  // learner — it advertises a heading with nothing under it. Authors keep
  // seeing them, because that is where they attach the content.
  const visible = includeUnpublished ? sections : sections.filter((s) => s.activities.length);

  // The topic's own identity travels top-level, so a hub whose steps are all
  // still drafts can still show the real title and the author's welcome
  // instead of falling back to the raw course id.
  return {
    course_id: courseId,
    enrolment,
    title: modules.length ? modules[0].title : null,
    summary: modules.length ? modules[0].summary : null,
    welcome: modules.length ? (modules[0].welcome || null) : null,
    sections: visible,
  };
}

// ─── Reporting ───────────────────────────────────────────────────────

async function cohort(courseId) {
  const enrolments = await db.all(
    `SELECT e.*,
            TRIM(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) AS lawyer_name,
            l.email AS lawyer_email,
            l.firm_id AS firm_id
     FROM enrolment e
     LEFT JOIN lawyers l ON l.id = e.lawyer_id
     WHERE e.course_id = ?
     ORDER BY e.percent DESC, e.last_active_at DESC`,
    [courseId]
  );

  // Where people stall: the required activities with the most learners
  // started-but-not-finished. This is the number that tells an admin the
  // content is wrong rather than the learners being slow.
  const stalls = await db.all(
    `SELECT a.id, a.title, a.kind,
            SUM(CASE WHEN p.status = 'in_progress' THEN 1 ELSE 0 END) AS stalled,
            SUM(CASE WHEN p.status IN ('completed','passed') THEN 1 ELSE 0 END) AS finished
     FROM activity a
     LEFT JOIN activity_progress p ON p.activity_id = a.id
     WHERE a.course_id = ? AND a.published = 1 AND a.required = 1
     GROUP BY a.id, a.title, a.kind
     ORDER BY stalled DESC`,
    [courseId]
  );

  return { course_id: courseId, enrolments, stalls };
}

// Everything one lawyer has done, across every course, with the attempt
// log attached. This is the input an AI progress report reads — and the
// reason the report never has to invent a number.
async function learnerReport(lawyerId, { attemptLimit = 200 } = {}) {
  const [enrolments, progress, attempts] = await Promise.all([
    listEnrolmentsForLawyer(lawyerId),
    db.all(
      `SELECT p.*, a.title, a.kind, a.course_id AS act_course, a.pass_score
       FROM activity_progress p
       JOIN activity a ON a.id = p.activity_id
       WHERE p.lawyer_id = ?
       ORDER BY p.last_at DESC`,
      [lawyerId]
    ),
    db.all(
      `SELECT at.*, a.title
       FROM activity_attempt at
       LEFT JOIN activity a ON a.id = at.activity_id
       WHERE at.lawyer_id = ?
       ORDER BY at.started_at DESC
       LIMIT ?`,
      [lawyerId, attemptLimit]
    ),
  ]);

  return {
    lawyer_id: lawyerId,
    generated_at: db.now(),
    enrolments,
    activities: progress.map(hydrateProgress),
    attempts: attempts.map(hydrateAttempt),
  };
}

module.exports = {
  KINDS,
  listModules, upsertModule, deleteModule,
  listActivities, getActivity, upsertActivity, retireActivity, reorderActivities,
  getEnrolment, ensureEnrolment, listEnrolmentsForLawyer,
  getProgress, listProgressForCourse,
  startAttempt, getAttempt, closeAttempt,
  recompute, recomputeCourse,
  getOutline, cohort, learnerReport,
  settleStatus, countsAsDone,
};
