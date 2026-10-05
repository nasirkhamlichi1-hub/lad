'use strict';

// Functional check for the reference library's extras: insights (summaries,
// subjects, situations, questions, step links), the article reader, the
// self-test, and the learner's reading trail — through the real HTTP routes,
// with the AI model replaced by a stub so the check needs no key and can
// prove that ids the model invents are dropped.
//
//   APP_BRAND=freelance DATABASE_URL=./data/freelance-test.sqlite node scripts/migrate.js
//   APP_BRAND=freelance DATABASE_URL=./data/freelance-test.sqlite node scripts/test-library-insights.js

const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const aimodel = require('../src/services/aimodel');
const topics = require('../src/lms/topics');
const store = require('../src/lms/store');
const jwt = require('../src/services/jwt');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── The model, stubbed ──────────────────────────────────────────────
let calls = 0;
let ids = {};
aimodel.configured = () => true;
aimodel.chat = async ({ system, messages }) => {
  calls++;
  const user = messages[0].content;
  if (/catalogue the reference library/.test(system)) {
    const found = Array.from(user.matchAll(/^id: (\S+)/gm)).map((m) => m[1]);
    return JSON.stringify({ documents: found.map((id) => ({
      id, summary_en: 'Sets the rules for ' + id + '.', summary_ar: 'يحدد قواعد ' + id + '.',
      subject_en: id === ids.fees ? 'Fees and fines' : 'Professional conduct', subject_ar: id === ids.fees ? 'الرسوم والغرامات' : 'السلوك المهني',
    })).concat([{ id: 'MT-INVENTED', summary_en: 'Made up', subject_en: 'Ghosts' }]) });
  }
  if (/design the reference library/.test(system)) {
    return 'Here you go: ' + JSON.stringify({
      situations: [
        { en: 'I received a complaint', ar: 'تلقيت شكوى', documents: [ids.conduct, 'MT-INVENTED', ids.fees] },
        { en: 'Nothing real here', ar: '—', documents: ['MT-NOPE'] },
      ],
      questions: { en: ['What are the fines?', 'Who hears complaints?'], ar: ['ما الغرامات؟'] },
      steps: [{ step: ids.aiStep, documents: [ids.conduct, 'MT-INVENTED'] }, { step: 'ACT-NOPE', documents: [ids.fees] }],
    });
  }
  if (/self-test/.test(system)) {
    return JSON.stringify({ questions: [
      { q: 'Who hears complaints?', options: ['The committee', 'The court', 'Nobody'], answer: 0, article: 'Article 2', why: 'Article 2 says so.' },
      { q: 'Bad answer index', options: ['a', 'b'], answer: 7, article: 'Article 1' },
      { q: 'Invented article', options: ['x', 'y', 'z'], answer: 1, article: 'Article 99' },
    ] });
  }
  return '{}';
};

async function main() {
  console.log('\nReference library extras — functional check\n');
  const ts = Date.now().toString(36);

  // A course with two steps and two documents with text, one without.
  const adminId = `S-LIB-${ts}`;
  db.prepare("INSERT INTO staff (id, email, first_name, last_name, role, status, password_hash) VALUES (?,?,?,?,?,?,?)")
    .run(adminId, `lib.${ts}@freelance.test`, 'Library', 'Admin', 'lad_admin', 'active', 'x');
  const lawyerId = `L-LIB-${ts}`;
  db.prepare(`INSERT INTO lawyers (id, email, first_name, last_name, firm_id, password_hash, status, credit_balance)
              VALUES (?,?,?,?,NULL,?,'active',0)`).run(lawyerId, `reader.${ts}@freelance.test`, 'Reem', 'Reader', bcrypt.hashSync('x', 4));
  const outsiderId = `L-OUT-${ts}`;
  db.prepare(`INSERT INTO lawyers (id, email, first_name, last_name, firm_id, password_hash, status, credit_balance)
              VALUES (?,?,?,?,NULL,?,'active',0)`).run(outsiderId, `out.${ts}@freelance.test`, 'Omar', 'Outside', bcrypt.hashSync('x', 4));

  const topic = await topics.createTopic({ title: `Conduct ${ts}`, steps: [{ kind: 'document' }, { kind: 'ai' }] }, adminId);
  const course = topic.topic_id;
  const docStep = topic.activities.find((a) => a.kind === 'document');
  ids.aiStep = topic.activities.find((a) => a.kind === 'ai_lesson').id;
  const addDoc = (title, text) => {
    const id = `MT-${ts}-${Math.random().toString(36).slice(2, 7)}`;
    db.prepare("INSERT INTO course_materials (id, course_id, title, kind, file_name, mime, data, created_at) VALUES (?,?,?,?,?,?,?,datetime('now'))")
      .run(id, course, title, 'file', title + '.txt', 'text/plain', text ? Buffer.from(text).toString('base64') : null);
    return id;
  };
  ids.conduct = addDoc('Conduct resolution', 'Preamble text.\n\nArticle 1\nThis resolution applies to advocates.\n\nArticle 2\nThe committee hears complaints against advocates.\n\nArticle 3\nThe committee decides within thirty days.');
  ids.fees = addDoc('Fees resolution', 'Article 1\nFees are payable on licensing.\n\nArticle 2\nA fine applies to late renewal.');
  await store.upsertActivity(course, { ...docStep, material_id: ids.fees });
  await topics.publishTopic(course, { force: true });
  await store.ensureEnrolment(course, lawyerId, 'self');
  const libIndex = require('../src/services/materialIndex');
  await libIndex.ensureIndexed(course);

  // The real routes, on an ephemeral port.
  const app = express();
  app.use(express.json());
  app.use('/api/v1/courses', require('../src/routes/courses'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/courses/${encodeURIComponent(course)}/materials`;
  const tok = jwt.sign({ sub: lawyerId, user_type: 'lawyer', role: 'lawyer' });
  const outTok = jwt.sign({ sub: outsiderId, user_type: 'lawyer', role: 'lawyer' });
  const as = (t) => ({ headers: t ? { Authorization: 'Bearer ' + t } : {}, validateStatus: () => true });

  console.log('access');
  check('an outsider is refused the insights', (await axios.get(base + '/insights', as(outTok))).status, 403);
  check('an outsider is refused the articles', (await axios.get(base + '/' + ids.conduct + '/articles', as(outTok))).status, 403);
  check('the reading trail needs a sign-in', (await axios.get(base + '/reads', as(null))).status, 401);

  console.log('\ninsights');
  const first = await axios.get(base + '/insights', as(tok));
  check('first visit starts a draft and says it is pending', [first.status, first.data.available, first.data.pending], [200, true, true]);
  let ins = null;
  for (let i = 0; i < 50 && !(ins && ins.documents); i++) { await wait(100); ins = (await axios.get(base + '/insights', as(tok))).data; }
  check('the draft lands', !!(ins && ins.documents), true);
  check('every real document has a summary', [ids.conduct, ids.fees].map((id) => !!(ins.documents[id] && ins.documents[id].summary_en)), [true, true]);
  check('an invented document is dropped', 'MT-INVENTED' in ins.documents, false);
  check('subjects are grouped', ins.subjects.map((s) => s.en).sort(), ['Fees and fines', 'Professional conduct']);
  check('situations keep only real documents, in order', ins.situations.map((s) => s.documents), [[ids.conduct, ids.fees]]);
  check('questions in both languages', [ins.questions.en.length, ins.questions.ar.length], [2, 1]);
  check('step links keep only real steps and documents', ins.steps[ids.aiStep], [ids.conduct]);
  check('a document step links to its own document', ins.steps[docStep.id], [ids.fees]);
  check('an invented step is dropped', 'ACT-NOPE' in ins.steps, false);
  const before = calls;
  await axios.get(base + '/insights', as(tok));
  check('a second visit is served from the cache', calls, before);
  db.prepare('UPDATE course_materials SET title = ? WHERE id = ?').run('Conduct resolution (amended)', ids.conduct);
  const stale = (await axios.get(base + '/insights', as(tok))).data;
  check('a renamed document serves the old draft, marked stale', [!!stale.documents, stale.stale], [true, true]);
  await wait(300);
  check('and the fresh draft replaces it', (await axios.get(base + '/insights', as(tok))).data.stale, undefined);

  console.log('\nreader');
  const arts = (await axios.get(base + '/' + ids.conduct + '/articles', as(tok))).data;
  check('the document comes back article by article', arts.articles.map((a) => a.label), ['Article 1', 'Article 2', 'Article 3']);
  check('a material of another course is not found', (await axios.get(base + '/MT-NOPE/articles', as(tok))).status, 404);

  console.log('\nself-test');
  const qz = await axios.post(base + '/' + ids.conduct + '/quiz', { lang: 'en' }, as(tok));
  check('questions with a valid answer survive', qz.data.questions.map((q) => q.q), ['Who hears complaints?', 'Invented article']);
  check('a real article is kept', qz.data.questions[0].article, 'Article 2');
  check('an invented article is dropped', qz.data.questions[1].article, null);
  const qcalls = calls;
  await axios.post(base + '/' + ids.conduct + '/quiz', { lang: 'en' }, as(tok));
  check('the same test is served from the cache', calls, qcalls);

  console.log('\nreading trail');
  check('starts empty', (await axios.get(base + '/reads', as(tok))).data.reads, {});
  await axios.post(base + '/' + ids.conduct + '/read', {}, as(tok));
  await axios.post(base + '/' + ids.conduct + '/read', {}, as(tok));
  const pin = await axios.put(base + '/' + ids.fees + '/pin', { pinned: true }, as(tok));
  check('pinning answers with the new state', [pin.data.pinned, pin.data.opened], [true, false]);
  const reads = (await axios.get(base + '/reads', as(tok))).data.reads;
  check('opens are counted', reads[ids.conduct].opens, 2);
  check('a pinned, unopened document', [reads[ids.fees].pinned, reads[ids.fees].opened], [true, false]);
  check('a material of another course cannot be marked', (await axios.post(base + '/MT-NOPE/read', {}, as(tok))).status, 404);
  const adminTok = jwt.sign({ sub: adminId, user_type: 'staff', role: 'lad_admin' });
  check('another user does not see this trail', (await axios.get(base + '/reads', as(adminTok))).data.reads, {});

  // ─── cleanup ───────────────────────────────────────────────────
  server.close();
  db.prepare('DELETE FROM material_read WHERE course_id = ?').run(course);
  db.prepare("DELETE FROM library_cache WHERE key = ? OR key LIKE ?").run('insights:' + course, 'quiz:MT-' + ts + '%');
  db.prepare('DELETE FROM material_article WHERE course_id = ?').run(course);
  db.prepare('DELETE FROM course_materials WHERE course_id = ?').run(course);
  await topics.deleteTopic(course);
  db.prepare('DELETE FROM lawyers WHERE id IN (?, ?)').run(lawyerId, outsiderId);
  db.prepare('DELETE FROM staff WHERE id = ?').run(adminId);

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nfailed:', e.message, '\n', e.stack); process.exit(1); });
