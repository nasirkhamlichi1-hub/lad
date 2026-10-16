// Auto-build a structured CLPD course from raw source material (e.g. a slide
// deck's text). Admin-gated. Uses Claude to design lessons, then stores the
// course in Azure Table (partition 'courses') so the trainer can load it.
const S = require('../_shared');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const P_COURSES = 'courses';

const SYS = `You are an expert legal instructional designer for the Dubai Legal Affairs Department CLPD programme. From the SOURCE MATERIAL provided, design a high-quality, structured training course.
Rules:
- Use ONLY the source material — never invent legal rules or add outside content. Where the source is thin, keep that lesson modest rather than padding it.
- Produce 5 to 9 lessons in a sensible learning progression. The FIRST lesson is a short welcome/orientation (objectives about the shape of the programme and how the session runs). A short final assessment lesson is welcome.
- Each lesson has: a clear "title"; a one-line "summary"; 3 to 5 specific, measurable "objectives" (the key elements a trainer must take the learner through); and a "body" — a teaching brief of about 150-400 words in plain professional prose that a live trainer teaches FROM (not reads out), drawn strictly from the source.
- Output ONLY a JSON object, no other text: {"lessons":[{"title":"...","summary":"...","objectives":["..."],"body":"..."}]}.`;

module.exports = async function (context, req) {
  if (!S.adminOk(req)) return S.json(context, 401, { error: 'Administrator access required.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return S.json(context, 503, { error: 'ANTHROPIC_API_KEY is not set on the server.' });
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 120);
  const source = String(b.sourceText || '').trim().slice(0, 60000);
  if (!title) return S.json(context, 400, { error: 'A course title is required.' });
  if (source.length < 200) return S.json(context, 400, { error: 'Please paste more source material (at least a few paragraphs).' });
  let courseId = String(b.courseId || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  if (!courseId) courseId = 'course-' + Date.now();

  let data;
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.TRAINER_MODEL || 'claude-sonnet-4-6', max_tokens: 8000, system: SYS, messages: [{ role: 'user', content: 'COURSE TITLE: ' + title + '\n\nSOURCE MATERIAL:\n' + source }] })
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); context.log.error('course-build upstream', r.status, t); return S.json(context, 502, { error: 'Course generation failed (upstream ' + r.status + ').' }); }
    const j = await r.json();
    const text = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    data = JSON.parse(m ? m[0] : text);
  } catch (e) { context.log.error('course-build parse', e && e.message); return S.json(context, 502, { error: 'Could not generate a valid course — try again or trim the source.' }); }

  let lessons = Array.isArray(data.lessons) ? data.lessons : [];
  lessons = lessons.filter(L => L && L.title).slice(0, 12).map((L, i) => ({
    id: courseId + '_' + String(i).padStart(2, '0'),
    course_id: courseId, mode: 'lesson',
    title: String(L.title).slice(0, 140),
    summary: String(L.summary || '').slice(0, 200),
    objectives: (Array.isArray(L.objectives) ? L.objectives : []).filter(o => typeof o === 'string' && o.trim()).map(o => o.trim().slice(0, 200)).slice(0, 6),
    body: String(L.body || '').slice(0, 8000),
    duration_min: 10, cpd_points: 1
  }));
  if (!lessons.length) return S.json(context, 502, { error: 'The generator returned no lessons — try again.' });

  let c; try { c = S.client(); await S.ensureTable(c); } catch (e) { return S.json(context, 500, { error: 'store unavailable' }); }
  try { await c.upsertEntity({ partitionKey: P_COURSES, rowKey: courseId, courseId, title, lessons: JSON.stringify(lessons), count: lessons.length, createdAt: new Date().toISOString() }, 'Replace'); }
  catch (e) { context.log.error('course save', e && e.message); return S.json(context, 500, { error: 'Could not save the course.' }); }
  return S.json(context, 200, { ok: true, courseId, title, count: lessons.length, lessons });
};
