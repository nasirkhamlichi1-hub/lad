'use strict';

// ─────────────────────────────────────────────────────────────────────
// Topics — composing a learning journey in one step.
// ─────────────────────────────────────────────────────────────────────
// A topic is a course of study: a title, and a journey made of however
// many SCORM packages, documents and AI-taught sessions the author wants.
// This module turns "two SCORMs, three documents and two AI bots" into the
// spine's own rows, in the right order, ready for content to be attached.
//
// The pieces it creates are deliberately UNPUBLISHED. An activity with no
// SCORM package behind it, or an AI bot with no material to teach from,
// would appear in a lawyer's hub as something they cannot do — so a slot
// stays invisible to learners until it has content and the author
// publishes it. `readiness()` reports exactly what is still missing.
//
// AI bots are real trainer_lessons rows, which is what makes them the same
// AI teacher the rest of the platform already runs: Anam face, Claude
// brain, the resume recap, the coverage tracking. Nothing about the bot is
// re-implemented here — a topic just creates the lesson and points an
// activity at it.

const db = require('./engine');
const store = require('./store');
const trainerStore = require('../services/trainerStore');

const MAX_PER_KIND = 40;

function slugify(text, fallback) {
  const s = String(text || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || fallback;
}

function clampCount(n) {
  const v = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(MAX_PER_KIND, v));
}

const KIND_ALIASES = {
  ai: 'ai_lesson', bot: 'ai_lesson', ai_bot: 'ai_lesson', ai_lesson: 'ai_lesson',
  scorm: 'scorm', package: 'scorm',
  document: 'document', material: 'document', doc: 'document', reading: 'document',
  link: 'link', video: 'video',
};

function normaliseKind(k) {
  return KIND_ALIASES[String(k || '').toLowerCase().trim()] || null;
}

// Turn whatever the caller sent into a flat, ordered list of steps.
//
//   steps: [{kind:'ai_lesson'}, {kind:'scorm', count:10}, {kind:'ai_lesson'}]
//     → AI, then ten SCORM packages, then another AI — in that order.
//
// A step may carry its own `title` and `pass_score`; anything it omits
// falls back to the topic's defaults. Counts within a step expand in
// place, so "10 SCORMs" stays one authoring gesture.
function normaliseSteps(input) {
  const out = [];

  if (Array.isArray(input.steps) && input.steps.length) {
    for (const raw of input.steps) {
      const kind = normaliseKind(raw && (raw.kind || raw.type));
      if (!kind) continue;
      const n = Math.max(1, clampCount(raw.count === undefined ? 1 : raw.count));
      for (let i = 0; i < n; i++) {
        out.push({ kind, title: raw.title || null, pass_score: raw.pass_score, seq: i + 1, of: n });
      }
    }
    return out.slice(0, MAX_PER_KIND * 6);
  }

  // Legacy count form. Read, then be taught, then be tested — the order
  // that makes sense when the caller expressed no order at all.
  const counts = {
    document: clampCount(input.documents),
    ai_lesson: clampCount(input.ai_bots),
    scorm: clampCount(input.scorms),
  };
  for (const kind of ['document', 'ai_lesson', 'scorm']) {
    for (let i = 0; i < counts[kind]; i++) {
      out.push({ kind, title: null, seq: i + 1, of: counts[kind] });
    }
  }
  return out;
}

// Default titles, numbered only when there is more than one of a kind.
function defaultTitle(topicTitle, slot, kind) {
  if (slot.title) return slot.title;
  const label = slot.of > 1 ? ` ${slot.seq}` : '';
  if (kind === 'scorm') return `${topicTitle} — assessment${label}`;
  if (kind === 'ai_lesson') return `${topicTitle} — taught session${label}`;
  if (kind === 'video') return `${topicTitle} — video${label}`;
  return `${topicTitle} — reading${label}`;
}

// What the author still has to do before a slot can go live. Returned with
// every topic read so the builder can show the remaining work rather than
// leaving someone to guess why nothing appears in the hub.
function readiness(activity) {
  if (activity.kind === 'scorm') {
    return activity.material_id || activity.package_id
      ? { ready: true, needs: null }
      : { ready: false, needs: 'Upload or link the SCORM package' };
  }
  if (activity.kind === 'document' || activity.kind === 'link' || activity.kind === 'video') {
    return activity.material_id
      ? { ready: true, needs: null }
      : { ready: false, needs: 'Attach the file or link' };
  }
  if (activity.kind === 'ai_lesson') {
    if (!activity.lesson_id) return { ready: false, needs: 'Create the AI session' };
    const lesson = trainerStore.getLesson(activity.lesson_id);
    if (!lesson || !lesson.body || lesson.body.trim().length < 40) {
      return { ready: false, needs: 'Give the AI bot material to teach from' };
    }
    if (!Array.isArray(lesson.objectives) || lesson.objectives.length === 0) {
      return { ready: false, needs: 'Add at least one learning objective' };
    }
    return { ready: true, needs: null };
  }
  return { ready: true, needs: null };
}

// ─── Creating a topic ────────────────────────────────────────────────

async function createTopic(input = {}, userId = null) {
  const title = String(input.title || '').trim();
  if (!title) {
    const err = new Error('A topic needs a title');
    err.status = 400;
    throw err;
  }

  const courseId = input.topic_id
    ? slugify(input.topic_id, null)
    : slugify(title, `TOPIC-${Date.now().toString(36).toUpperCase()}`);

  const existing = await db.one('SELECT id FROM activity WHERE course_id = ? LIMIT 1', [courseId]);
  if (existing && !input.allow_existing) {
    const err = new Error(`A topic with the id ${courseId} already exists. Add to it, or choose another title.`);
    err.status = 409;
    throw err;
  }

  // A topic is an ordered sequence, not a set of quantities. `steps` is
  // the real input: [{kind, count?}, …] in the order the author wants —
  // AI, SCORM, AI, AI, material, SCORM is as ordinary as three of each.
  //
  // The older count form ({scorms, documents, ai_bots}) still works and
  // is expanded into a sensible default order, so nothing that already
  // calls this breaks.
  const steps = normaliseSteps(input);

  if (!steps.length) {
    const err = new Error('A topic needs at least one step — a SCORM package, a document or an AI session');
    err.status = 400;
    throw err;
  }

  const gate = input.gate === 'sequential' ? 'sequential' : 'none';
  const passScore = input.pass_score === null || input.pass_score === undefined
    ? 80
    : Math.max(0, Math.min(100, Number(input.pass_score) || 0));

  const moduleRow = await store.upsertModule(courseId, {
    title: input.module_title || title,
    summary: input.summary || null,
    position: 0,
    gate,
  });

  const plan = steps;

  // Positions are unique across the whole topic, not per section. When a
  // second section is added later its slots have to continue the sequence
  // — restarting at zero would interleave them with the first section's
  // when the outline sorts by position.
  const highest = await db.one(
    'SELECT COALESCE(MAX(position), -1) AS p FROM activity WHERE course_id = ?',
    [courseId]
  );
  const offset = (highest ? Number(highest.p) : -1) + 1;

  const created = [];
  for (let i = 0; i < plan.length; i++) {
    const slot = plan[i];
    const slotTitle = defaultTitle(title, slot, slot.kind);

    let lessonId = null;
    if (slot.kind === 'ai_lesson') {
      // A real trainer lesson, so the bot is the platform's existing AI
      // teacher rather than a new thing. Empty on purpose — the author
      // fills in what it teaches, and readiness() keeps it hidden until
      // they do.
      const lesson = trainerStore.upsertLesson({
        title: slotTitle,
        summary: null,
        body: '',
        objectives: [],
        course_id: courseId,
        duration_min: 30,
        cpd_points: 0,
        // Must be `false`, not 0 — trainerStore.upsertLesson tests
        // `active === false`, so a falsy 0 would activate the bot.
        active: false,
      }, userId);
      lessonId = lesson.id;
    }

    const activity = await store.upsertActivity(courseId, {
      module_id: moduleRow.id,
      kind: slot.kind,
      title: slotTitle,
      position: offset + i,
      required: true,
      // Only an assessment carries a pass mark by default; a step may
      // override it, including setting one on a taught session.
      pass_score: slot.pass_score !== undefined && slot.pass_score !== null
        ? Math.max(0, Math.min(100, Number(slot.pass_score) || 0))
        : (slot.kind === 'scorm' ? passScore : null),
      lesson_id: lessonId,
      published: false,
      origin: 'authored',
    }, userId);

    created.push(activity);
  }

  return getTopic(courseId);
}

// ─── Reading topics ──────────────────────────────────────────────────

async function getTopic(courseId) {
  const [modules, activities] = await Promise.all([
    store.listModules(courseId),
    store.listActivities(courseId, { includeUnpublished: true }),
  ]);

  const decorated = activities.map((a) => {
    const r = readiness(a);
    const lesson = a.kind === 'ai_lesson' && a.lesson_id ? trainerStore.getLesson(a.lesson_id) : null;
    return {
      ...a,
      ready: r.ready,
      needs: r.needs,
      lesson: lesson
        ? { id: lesson.id, title: lesson.title, objectives: lesson.objectives, has_body: !!(lesson.body || '').trim(), active: lesson.active }
        : null,
    };
  });

  const learners = await db.one(
    'SELECT COUNT(*) AS n FROM enrolment WHERE course_id = ?',
    [courseId]
  );

  return {
    topic_id: courseId,
    title: modules.length ? modules[0].title : courseId,
    summary: modules.length ? modules[0].summary : null,
    gate: modules.length ? modules[0].gate : 'none',
    modules,
    activities: decorated,
    counts: {
      scorm: decorated.filter((a) => a.kind === 'scorm').length,
      document: decorated.filter((a) => ['document', 'link', 'video'].includes(a.kind)).length,
      ai_lesson: decorated.filter((a) => a.kind === 'ai_lesson').length,
    },
    outstanding: decorated.filter((a) => !a.ready).length,
    published: decorated.filter((a) => a.published).length,
    learners: learners ? Number(learners.n) || 0 : 0,
  };
}

async function listTopics() {
  const rows = await db.all(
    `SELECT a.course_id,
            COUNT(*) AS activities,
            SUM(CASE WHEN a.published = 1 THEN 1 ELSE 0 END) AS published,
            SUM(CASE WHEN a.kind = 'scorm' THEN 1 ELSE 0 END) AS scorms,
            SUM(CASE WHEN a.kind = 'ai_lesson' THEN 1 ELSE 0 END) AS ai_bots,
            SUM(CASE WHEN a.kind IN ('document','link','video') THEN 1 ELSE 0 END) AS documents,
            MAX(a.updated_at) AS updated_at
     FROM activity a
     GROUP BY a.course_id
     ORDER BY updated_at DESC`
  );

  const out = [];
  for (const r of rows) {
    const mods = await store.listModules(r.course_id);
    const learners = await db.one('SELECT COUNT(*) AS n FROM enrolment WHERE course_id = ?', [r.course_id]);
    out.push({
      topic_id: r.course_id,
      title: mods.length ? mods[0].title : r.course_id,
      activities: Number(r.activities) || 0,
      published: Number(r.published) || 0,
      counts: {
        scorm: Number(r.scorms) || 0,
        ai_lesson: Number(r.ai_bots) || 0,
        document: Number(r.documents) || 0,
      },
      learners: learners ? Number(learners.n) || 0 : 0,
      updated_at: r.updated_at,
    });
  }
  return out;
}

// Add more parts to a topic that already exists — the same composer,
// appended rather than replacing.
async function addToTopic(courseId, input = {}, userId = null) {
  const topic = await getTopic(courseId);
  if (!topic.activities.length) {
    const err = new Error('No such topic');
    err.status = 404;
    throw err;
  }
  return createTopic({
    ...input,
    topic_id: courseId,
    title: input.title || topic.title,
    allow_existing: true,
  }, userId);
}

// Publishing checks readiness rather than trusting the caller: an author
// cannot accidentally push an empty SCORM slot or an untaught bot live.
async function publishTopic(courseId, { force = false } = {}) {
  const topic = await getTopic(courseId);
  const blocked = topic.activities.filter((a) => !a.ready);
  if (blocked.length && !force) {
    return { published: 0, blocked: blocked.map((a) => ({ id: a.id, title: a.title, needs: a.needs })) };
  }

  let n = 0;
  for (const a of topic.activities) {
    if (!a.ready && !force) continue;
    if (a.published) continue;
    await db.run('UPDATE activity SET published = 1, updated_at = ? WHERE id = ?', [db.now(), a.id]);
    if (a.kind === 'ai_lesson' && a.lesson_id) {
      await db.run('UPDATE trainer_lessons SET active = 1 WHERE id = ?', [a.lesson_id]);
    }
    n++;
  }
  await store.recomputeCourse(courseId);
  return { published: n, blocked: [] };
}

// ─── Editing the sequence ────────────────────────────────────────────

// Insert steps anywhere in the journey. `at` is the index to insert
// before; omit it to append. Everything at or after that index shifts
// down, so inserting an AI session between two SCORMs is one call.
async function insertSteps(courseId, { kind, count = 1, at = null, title = null, pass_score } = {}, userId = null) {
  const k = normaliseKind(kind);
  if (!k) {
    const err = new Error('Unknown step type');
    err.status = 400;
    throw err;
  }

  const existing = await store.listActivities(courseId, { includeUnpublished: true });
  if (!existing.length) {
    const err = new Error('No such topic');
    err.status = 404;
    throw err;
  }

  const ordered = existing.slice().sort((a, b) => a.position - b.position);
  const index = at === null || at === undefined
    ? ordered.length
    : Math.max(0, Math.min(ordered.length, Math.floor(Number(at)) || 0));

  const n = Math.max(1, clampCount(count));

  // Push the tail down far enough to open a gap, then fill it. Done in
  // one pass so a half-applied insert can't leave two steps sharing a
  // position.
  await db.tx(async (t) => {
    const ts = db.now();
    for (let i = ordered.length - 1; i >= index; i--) {
      await t.run('UPDATE activity SET position = ?, updated_at = ? WHERE id = ?',
        [ordered[i].position + n, ts, ordered[i].id]);
    }
  });

  const moduleRow = (await store.listModules(courseId))[0] || null;
  const topicTitle = moduleRow ? moduleRow.title : courseId;

  for (let i = 0; i < n; i++) {
    let lessonId = null;
    const slot = { title, seq: i + 1, of: n, pass_score };
    const slotTitle = defaultTitle(topicTitle, slot, k);

    if (k === 'ai_lesson') {
      const lesson = trainerStore.upsertLesson({
        title: slotTitle, summary: null, body: '', objectives: [],
        course_id: courseId, duration_min: 30, cpd_points: 0, active: false,
      }, userId);
      lessonId = lesson.id;
    }

    await store.upsertActivity(courseId, {
      module_id: moduleRow ? moduleRow.id : null,
      kind: k,
      title: slotTitle,
      position: index + i,
      required: true,
      pass_score: pass_score !== undefined && pass_score !== null
        ? Math.max(0, Math.min(100, Number(pass_score) || 0))
        : (k === 'scorm' ? 80 : null),
      lesson_id: lessonId,
      published: false,
      origin: 'authored',
    }, userId);
  }

  return getTopic(courseId);
}

// Move one step to a new index, closing the gap behind it. Positions are
// rewritten densely afterwards so they never drift.
async function moveStep(courseId, activityId, toIndex) {
  const ordered = (await store.listActivities(courseId, { includeUnpublished: true }))
    .slice().sort((a, b) => a.position - b.position);

  const from = ordered.findIndex((a) => a.id === activityId);
  if (from < 0) {
    const err = new Error('No such step in this topic');
    err.status = 404;
    throw err;
  }

  const to = Math.max(0, Math.min(ordered.length - 1, Math.floor(Number(toIndex))));
  if (to === from) return getTopic(courseId);

  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);

  await store.reorderActivities(courseId, ordered.map((a) => a.id));
  return getTopic(courseId);
}

// Remove a step. A draft nobody has touched is deleted outright; one that
// has attempts against it is retired instead, because those attempts are
// evidence and must outlive the syllabus.
async function removeStep(courseId, activityId) {
  const activity = await store.getActivity(activityId);
  if (!activity || activity.course_id !== courseId) {
    const err = new Error('No such step in this topic');
    err.status = 404;
    throw err;
  }

  const used = await db.one(
    'SELECT COUNT(*) AS n FROM activity_attempt WHERE activity_id = ?',
    [activityId]
  );

  let mode;
  if (used && Number(used.n) > 0) {
    await store.retireActivity(activityId);
    mode = 'retired';
  } else {
    if (activity.kind === 'ai_lesson' && activity.lesson_id) {
      trainerStore.deleteLesson(activity.lesson_id);
    }
    await db.run('DELETE FROM activity WHERE id = ?', [activityId]);
    mode = 'deleted';
  }

  // Close the gap so the sequence stays dense and 1..n reads correctly.
  const rest = (await store.listActivities(courseId, { includeUnpublished: true }))
    .slice().sort((a, b) => a.position - b.position);
  await store.reorderActivities(courseId, rest.map((a) => a.id));
  await store.recomputeCourse(courseId);

  return { mode, topic: await getTopic(courseId) };
}

module.exports = {
  createTopic, addToTopic, getTopic, listTopics, publishTopic,
  insertSteps, moveStep, removeStep,
  readiness, slugify, normaliseSteps,
};
