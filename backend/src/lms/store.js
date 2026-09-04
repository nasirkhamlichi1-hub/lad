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
  // null, not 0. Before 056 nothing wrote `seconds` until the close, so
  // defaulting to 0 was harmless. Now checkpoints bank time while the
  // attempt runs, and a close that reports no figure — the reaper settling
  // an abandoned sitting, or an engine that already checkpointed its time —
  // must leave what was banked alone rather than zeroing it.
  seconds = null,
  percent = null,
  detail = null,
  resumeState = null,
  abandoned = false,
} = {}) {
  const attempt = await getAttempt(attemptId);
  if (!attempt) return null;
  if (attempt.lawyer_id !== lawyerId) return null;

  // Which re-closes are no-ops, and which are not.
  //
  // Every settled verdict — completed, passed, failed, and the in_progress
  // an attempt gets when it ended without completing — is final. An engine
  // retrying a close on a flaky connection must not double-count, and
  // nothing may revise a sitting that already reported its result.
  //
  // 'abandoned' is the one exception, and it exists because the reaper
  // creates it. A
  // learner whose laptop slept through the stale window comes back to an
  // attempt the reaper has already settled; if this returned early, their
  // "Mark it done" would answer 200, the hub would close the dialog and
  // reload, and the completion — with its CPD minutes and its contribution
  // to the course — would vanish with nothing shown to anyone. So a genuine
  // completion arriving after a reap is allowed to settle the sitting it
  // belongs to. Re-abandoning an abandoned attempt stays a no-op.
  if (attempt.status !== 'open' && attempt.status !== 'abandoned') return attempt;
  if (attempt.status === 'abandoned' && abandoned) return attempt;

  const activity = await getActivity(attempt.activity_id);
  if (!activity) return null;

  // Only null/undefined means "no figure reported". A string, a NaN or a
  // negative used to coerce to 0 and then overwrite whatever checkpoints had
  // banked, so a malformed report from an engine erased real time on task.
  // A negative is treated as no figure rather than clamped to 0: time on task
  // only ever grows, so a negative is nonsense, and clamping it would let one
  // bad report erase everything the checkpoints banked.
  const rawSeconds = Number(seconds);
  const cleanSeconds = seconds === null || seconds === undefined
    || !Number.isFinite(rawSeconds) || rawSeconds < 0
    ? null
    : Math.round(rawSeconds);
  const cleanScore = clampScore(score);
  const status = abandoned ? 'in_progress' : settleStatus(activity, { completed, score: cleanScore });
  const ts = db.now();

  await db.tx(async (t) => {
    await t.run(
      `UPDATE activity_attempt
       SET status = ?, score = ?, seconds = COALESCE(?, seconds),
           detail = COALESCE(?, detail), ended_at = ?
       WHERE id = ?`,
      // The attempt keeps its own verdict — completed, passed, failed, or
      // in_progress when it ended without completing — not a flat
      // 'completed' for anything that was not abandoned. The roll-up below
      // reads that verdict; before this, closing with completed:false still
      // counted as a completion, and the only way to not complete was to
      // abandon.
      [abandoned ? 'abandoned' : status, cleanScore, cleanSeconds, db.toJson(detail), ts, attemptId]
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
              MAX(CASE WHEN status IN ('completed','passed','failed') THEN 1 ELSE 0 END) AS ever_completed
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
        roll ? Number(roll.seconds) || 0 : (cleanSeconds || 0),
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

// Report an open attempt still alive, and bank the ground covered so far.
//
// This is what makes progress survive a closed laptop. The launching engine
// calls it periodically while the learner works; each call writes the resume
// point, the seconds so far and the within-sitting percentage, and settles
// NOTHING. `status` is never touched here — only closeAttempt may decide an
// activity is finished, which keeps 048's rule intact: a completion is
// derived from a settled attempt, never asserted by a client mid-flight.
//
// Safe to call every few seconds and safe to call out of order: percent only
// ever climbs, and the aggregate's seconds are rebuilt from the attempt log
// rather than incremented, so a duplicate heartbeat cannot double-count.
async function checkpoint(attemptId, lawyerId, {
  resumeState = null,
  seconds = null,
  percent = null,
  detail = null,
} = {}) {
  const attempt = await getAttempt(attemptId);
  if (!attempt) return null;
  if (attempt.lawyer_id !== lawyerId) return null;

  // Already settled. Not an error — an engine that retries a heartbeat after
  // its close landed should get the truth back, not a 404 or a resurrection.
  if (attempt.status !== 'open') {
    return {
      attempt,
      progress: await getProgress(attempt.activity_id, lawyerId),
      settled: true,
    };
  }

  const ts = db.now();
  // As in closeAttempt: only null/undefined is "no figure". Anything
  // unparseable is ignored rather than coerced to 0, which would overwrite
  // banked time with nothing.
  const rawSeconds = Number(seconds);
  const cleanSeconds = seconds === null || seconds === undefined
    || !Number.isFinite(rawSeconds) || rawSeconds < 0
    ? null
    : Math.round(rawSeconds);
  const rawPercent = Number(percent);
  const cleanPercent = percent === null || percent === undefined || !Number.isFinite(rawPercent)
    ? null
    : clampPercent(rawPercent);

  await db.tx(async (t) => {
    await t.run(
      `UPDATE activity_attempt
       SET seconds       = COALESCE(?, seconds),
           percent       = COALESCE(?, percent),
           resume_state  = COALESCE(?, resume_state),
           detail        = COALESCE(?, detail),
           heartbeat_at  = ?
       WHERE id = ? AND status = 'open'`,
      [cleanSeconds, cleanPercent, resumeState, db.toJson(detail), ts, attemptId]
    );

    // Rebuild the aggregate's seconds from the log, exactly as closeAttempt
    // does, so the two paths can never disagree about time on task.
    const roll = await t.one(
      `SELECT COALESCE(SUM(seconds), 0) AS seconds
       FROM activity_attempt
       WHERE activity_id = ? AND lawyer_id = ?`,
      [attempt.activity_id, lawyerId]
    );

    const current = await t.one(
      'SELECT status, percent FROM activity_progress WHERE activity_id = ? AND lawyer_id = ?',
      [attempt.activity_id, lawyerId]
    );

    // The climb is computed here rather than in SQL because SQLite's
    // two-argument MAX() has no Postgres equivalent (it is GREATEST there),
    // and engine.js's contract forbids engine-specific functions.
    const settledAlready = current ? countsAsDone(current.status) : false;
    const nextPercent = settledAlready
      ? current.percent
      : Math.max(current ? current.percent || 0 : 0, cleanPercent === null ? 0 : cleanPercent);

    await t.run(
      `UPDATE activity_progress
       SET percent       = ?,
           resume_state  = COALESCE(?, resume_state),
           total_seconds = ?,
           last_at       = ?
       WHERE activity_id = ? AND lawyer_id = ?`,
      [
        nextPercent,
        resumeState,
        roll ? Number(roll.seconds) || 0 : 0,
        ts,
        attempt.activity_id,
        lawyerId,
      ]
    );
  });

  // Roll the banked time up to the enrolment through the same derivation
  // closeAttempt uses. recompute() reads only from activity_progress, so it
  // cannot invent a completion here: `percent` still comes from required
  // activities actually settled, and a checkpoint settles none. What it does
  // do is carry the seconds up, so time on task is visible on the course and
  // in the estate-wide view while the learner is still working rather than
  // only once they finish.
  const enrolment = await recompute(attempt.course_id, lawyerId);

  return {
    attempt: await getAttempt(attemptId),
    progress: await getProgress(attempt.activity_id, lawyerId),
    enrolment,
    settled: false,
  };
}

// Where a learner resumes this activity, if anywhere.
//
// Two different things can offer a resume point, and they are ranked. An
// attempt still open is the better one — the learner walked away mid-sitting
// and the engine can drop them back into it. Failing that, the aggregate's
// resume_state from the last sitting still lets a learner re-enter material
// they have seen before without starting from nothing.
async function resumeFor(activityId, lawyerId) {
  const progress = await getProgress(activityId, lawyerId);
  const open = hydrateAttempt(await db.one(
    `SELECT * FROM activity_attempt
     WHERE activity_id = ? AND lawyer_id = ? AND status = 'open'
     ORDER BY started_at DESC LIMIT 1`,
    [activityId, lawyerId]
  ));

  const state = (open && open.resume_state) || (progress && progress.resume_state) || null;

  return {
    activity_id: activityId,
    resumable: !!state || !!open,
    open_attempt: open,
    resume_state: state,
    percent: progress ? progress.percent : 0,
    status: progress ? progress.status : 'not_started',
    last_at: progress ? progress.last_at : null,
  };
}

// Settle attempts whose engine stopped reporting.
//
// An attempt left 'open' is not evidence of anything — the learner closed
// the tab, the browser crashed, the phone slept. Settling it as abandoned
// keeps every second and every checkpoint that was banked (closeAttempt with
// abandoned:true leaves the status at in_progress and preserves resume_state),
// while releasing the row from the open set the overview counts.
//
// `minutes` is the silence that counts as gone. Attempts predating 056 have
// no heartbeat, so started_at stands in — which settles the backlog on the
// first run and is why the fallback exists at all.
// `minutes` has a floor of 30 rather than 1. A one-minute window would settle
// every sitting currently in progress as abandoned, and the endpoint that
// exposes this is a reporting one — a mistyped parameter should not be able to
// reach across every learner on the platform.
async function reapStaleAttempts({ minutes = 120, limit = 500 } = {}) {
  const cutoff = new Date(Date.now() - Math.max(30, minutes) * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  const stale = await db.all(
    `SELECT id, lawyer_id FROM activity_attempt
     WHERE status = 'open' AND COALESCE(heartbeat_at, started_at) < ?
     ORDER BY started_at ASC
     LIMIT ?`,
    [cutoff, limit]
  );

  let reaped = 0;
  for (const row of stale) {
    // Go through closeAttempt rather than UPDATE-ing directly, so the
    // aggregate and the enrolment percentage are recomputed by the one code
    // path allowed to derive them.
    // No `seconds`: whatever the last checkpoint banked is the truth about
    // this sitting, and the reaper knows nothing better.
    const settled = await closeAttempt(row.id, row.lawyer_id, {
      completed: false,
      abandoned: true,
    });
    if (settled) reaped += 1;
  }

  return { reaped, examined: stale.length, cutoff };
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
            // Whether this activity offers a way back in.
            //
            // Two things qualify, and requiring only the first was too strict:
            // a saved resume point (an AI recap sentence, a SCORM suspend_data
            // pointer) OR simply an unfinished sitting. A document or a video
            // has no position worth storing, so it would never carry state —
            // yet a lawyer who opened it and stopped should still see "Resume"
            // rather than "Start", because that is what actually happened.
            //
            // The state itself stays opaque to everything but the launching
            // engine: the outline carries the flag for the UI and the payload
            // for the engine, and the UI never has to understand the payload.
            resumable: !countsAsDone(p.status)
              && (!!p.resume_state || p.status === 'in_progress'),
            resume_state: p.resume_state || null,
          }
        : {
            status: 'not_started',
            percent: 0,
            score: null,
            total_seconds: 0,
            attempt_count: 0,
            resumable: false,
            resume_state: null,
          },
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

// Everything, from above. The one query set behind the LAD super-user view.
//
// cohort() answers "how is this course going" and learnerReport() answers
// "how is this lawyer doing". Neither answers "how is the programme doing",
// which is the question a regulator actually opens the dashboard to ask. This
// does, in two registers at once: the totals band that goes in a board pack,
// and the operational detail that says who needs chasing this week.
//
// Every number here is read from the derived tables that attempts already
// maintain. Nothing is stored for the dashboard's benefit and nothing is
// cached, so the view cannot drift from the evidence — the 048 rule, held one
// level up.
//
// Portability: no engine-specific date functions. Window boundaries are
// computed in JS and passed as parameters, and day bucketing uses substr()
// on the fixed-width timestamps 048 mandates, which behaves identically on
// SQLite and Postgres.
async function overview({ days = 30, staleDays = 14, coldHours = 2 } = {}) {
  const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const nowMs = Date.now();
  const since = iso(new Date(nowMs - Math.max(1, days) * 86400000));
  const staleBefore = iso(new Date(nowMs - Math.max(1, staleDays) * 86400000));
  const coldBefore = iso(new Date(nowMs - Math.max(1, coldHours) * 3600000));

  const [
    totals, activeLearners, cpd, attemptTotals, byDay,
    byCourse, byFirm, stalledLearners, coldAttempts, stallPoints,
  ] = await Promise.all([
    // The enrolment table is the spine of every headline number: one row per
    // lawyer per course, with percent already derived from attempts.
    // in_flight is deliberately NOT `percent > 0`. Course percentage only
    // moves when a whole required activity settles, so a lawyer four sittings
    // into a long SCORM package is still on 0% — and counting them as "not
    // started" is the most misleading thing this dashboard could say. Anyone
    // who has touched an activity is in progress.
    db.one(
      `SELECT COUNT(*)                                              AS enrolments,
                COUNT(DISTINCT lawyer_id)                             AS learners,
                COUNT(DISTINCT course_id)                             AS courses,
                COALESCE(SUM(total_seconds), 0)                       AS seconds,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status <> 'completed' AND EXISTS (
                      SELECT 1 FROM activity_progress p
                      WHERE p.course_id = enrolment.course_id
                        AND p.lawyer_id = enrolment.lawyer_id
                        AND p.status <> 'not_started')
                    THEN 1 ELSE 0 END)                                AS in_flight
         FROM enrolment`
    ),

    db.one(
      'SELECT COUNT(DISTINCT lawyer_id) AS n FROM enrolment WHERE last_active_at >= ?',
      [since]
    ),

    // CPD actually delivered, as opposed to CPD on offer: minutes attached to
    // activities a learner has genuinely settled.
    db.one(
      `SELECT COALESCE(SUM(a.cpd_minutes), 0) AS minutes
       FROM activity_progress p
       JOIN activity a ON a.id = p.activity_id
       WHERE p.status IN ('completed', 'passed')`
    ),

    db.one(
      `SELECT COUNT(*)                                              AS attempts,
              SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)      AS open,
              SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
              COUNT(DISTINCT lawyer_id)                             AS learners
       FROM activity_attempt WHERE started_at >= ?`,
      [since]
    ),

    db.all(
      `SELECT substr(started_at, 1, 10) AS day,
              COUNT(*)                  AS attempts,
              COUNT(DISTINCT lawyer_id) AS learners
       FROM activity_attempt
       WHERE started_at >= ?
       GROUP BY substr(started_at, 1, 10)
       ORDER BY day ASC`,
      [since]
    ),

    db.all(
      `SELECT e.course_id,
              c.title                                               AS course_title,
              COUNT(*)                                              AS enrolled,
              COALESCE(ROUND(AVG(e.percent)), 0)                    AS avg_percent,
              SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN e.percent > 0 AND e.percent < 100 AND e.last_active_at < ?
                       THEN 1 ELSE 0 END)                           AS stalled,
              COALESCE(SUM(e.total_seconds), 0)                     AS seconds,
              MAX(e.last_active_at)                                 AS last_active_at
       FROM enrolment e
       LEFT JOIN courses c ON c.id = e.course_id
       GROUP BY e.course_id, c.title
       ORDER BY enrolled DESC, avg_percent ASC`,
      [staleBefore]
    ),

    db.all(
      `SELECT l.firm_id,
              f.name                                                AS firm_name,
              COUNT(DISTINCT e.lawyer_id)                           AS learners,
              COUNT(*)                                              AS enrolments,
              COALESCE(ROUND(AVG(e.percent)), 0)                    AS avg_percent,
              SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM enrolment e
       JOIN lawyers l ON l.id = e.lawyer_id
       LEFT JOIN firms f ON f.id = l.firm_id
       WHERE l.firm_id IS NOT NULL
       GROUP BY l.firm_id, f.name
       ORDER BY learners DESC`
    ),

    // Started, not finished, and gone quiet. The chase list.
    db.all(
      `SELECT e.lawyer_id, e.course_id, e.percent, e.last_active_at, e.total_seconds,
              TRIM(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) AS lawyer_name,
              l.email AS lawyer_email, l.firm_id AS firm_id,
              f.name  AS firm_name,
              c.title AS course_title
       FROM enrolment e
       LEFT JOIN lawyers l ON l.id = e.lawyer_id
       LEFT JOIN firms   f ON f.id = l.firm_id
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.status = 'active'
         AND e.percent > 0 AND e.percent < 100
         AND e.last_active_at < ?
       ORDER BY e.last_active_at ASC
       LIMIT 100`,
      [staleBefore]
    ),

    // Sittings the engine stopped reporting — the queue reapStaleAttempts()
    // exists to drain. A number here that never falls means the reaper is not
    // running, which is worth seeing on the dashboard rather than in a log.
    db.one(
      `SELECT COUNT(*) AS n, MIN(started_at) AS oldest
       FROM activity_attempt
       WHERE status = 'open' AND COALESCE(heartbeat_at, started_at) < ?`,
      [coldBefore]
    ),

    // Where people get stuck, across the whole estate rather than one course.
    // A required activity with many in-progress and few finished is usually a
    // content problem, not a learner problem.
    db.all(
      `SELECT a.id, a.title, a.kind, a.course_id,
              c.title AS course_title,
              SUM(CASE WHEN p.status = 'in_progress' THEN 1 ELSE 0 END)        AS stalled,
              SUM(CASE WHEN p.status IN ('completed','passed') THEN 1 ELSE 0 END) AS finished
       FROM activity a
       JOIN activity_progress p ON p.activity_id = a.id
       LEFT JOIN courses c ON c.id = a.course_id
       WHERE a.published = 1 AND a.required = 1
       GROUP BY a.id, a.title, a.kind, a.course_id, c.title
       -- The aggregate is repeated rather than referenced by its alias:
       -- SQLite accepts an output alias in HAVING, Postgres does not, and
       -- engine.js's contract is that this subsystem ports unchanged.
       -- (ORDER BY may use the alias in both.)
       HAVING SUM(CASE WHEN p.status = 'in_progress' THEN 1 ELSE 0 END) > 0
       ORDER BY stalled DESC
       LIMIT 20`
    ),
  ]);

  const enrolments = (totals && Number(totals.enrolments)) || 0;
  const completed = (totals && Number(totals.completed)) || 0;
  const inFlight = (totals && Number(totals.in_flight)) || 0;
  // Derived, not queried, so the three states always sum to the total. A
  // fourth independent COUNT could disagree with the other two at the edges;
  // subtraction cannot.
  const notStarted = Math.max(0, enrolments - completed - inFlight);

  return {
    generated_at: db.now(),
    window: { days, since, stale_days: staleDays, cold_hours: coldHours },

    headline: {
      learners: (totals && Number(totals.learners)) || 0,
      learners_active: (activeLearners && Number(activeLearners.n)) || 0,
      courses: (totals && Number(totals.courses)) || 0,
      enrolments,
      completed,
      in_flight: inFlight,
      not_started: notStarted,
      // Rounded once, here, so every surface that shows it shows the same
      // figure rather than each rounding its own way.
      completion_rate: enrolments ? Math.round((completed / enrolments) * 100) : 0,
      total_seconds: (totals && Number(totals.seconds)) || 0,
      cpd_minutes: (cpd && Number(cpd.minutes)) || 0,
      attempts: (attemptTotals && Number(attemptTotals.attempts)) || 0,
      attempts_open: (attemptTotals && Number(attemptTotals.open)) || 0,
      attempts_abandoned: (attemptTotals && Number(attemptTotals.abandoned)) || 0,
    },

    attention: {
      stalled_learners: stalledLearners,
      stalled_count: stalledLearners.length,
      cold_attempts: (coldAttempts && Number(coldAttempts.n)) || 0,
      cold_oldest: (coldAttempts && coldAttempts.oldest) || null,
      stall_points: stallPoints,
    },

    by_course: byCourse,
    by_firm: byFirm,
    by_day: byDay,
  };
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
  startAttempt, getAttempt, closeAttempt, checkpoint,
  resumeFor, reapStaleAttempts,
  recompute, recomputeCourse,
  getOutline, cohort, learnerReport, overview,
  settleStatus, countsAsDone,
};
