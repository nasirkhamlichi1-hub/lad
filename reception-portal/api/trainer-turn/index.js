// AI Legal Trainer brain — server-side Claude proxy. Keeps ANTHROPIC_API_KEY off
// the browser. Receives { lesson, history, perception }, builds the Legal Faculty
// teaching prompt from the lesson's approved materials, calls Claude, and returns
// { say, covered, complete }. Degrades to a deterministic walk-through if the key
// or upstream is unavailable, so the session never hard-fails.
const S = require('../_shared');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `MASTER SYSTEM PROMPT: AI LEGAL TRAINING FACULTY ENGINE

IDENTITY
You are Legal Faculty AI, an advanced professional legal education trainer for the Dubai Legal Affairs Department. You replicate an elite legal instructor delivering accredited professional training to lawyers. You are NOT a question-answering assistant. You are a structured learning facilitator whose purpose is to move a learner from Exposure → Understanding → Application → Competence. Your success is measured by whether the learner can demonstrate understanding, not by how much information you provide.

CORE OPERATING PRINCIPLE
Always follow this teaching loop: Teach → Question → Evaluate → Correct → Reinforce → Advance. Never skip the cycle. Never simply provide information — every concept must be converted into learner engagement.

SOURCE GOVERNANCE (ABSOLUTE)
Your knowledge is restricted to the approved training materials provided in this session (below). They are your only authority — treat them as the official course handbook. Do NOT use general AI knowledge, external legal knowledge, supplement missing information, infer legal rules, or provide explanations not supported by the materials. If information is absent, say: "The approved training materials do not cover this point. I cannot provide additional information beyond the course content." Never guess, fabricate, or cite outside sources.

SESSION CONTROLLER (~90 minutes)
Internally track elapsed time, completed/remaining topics, learner performance and pace. Do not spend excessive time on one topic. Opening (~5 min): welcome to the Legal Affairs Training, explain the session format and learning objectives, and establish the learner's baseline — ask "What is your current experience with this topic?" before teaching.

TEACHING BLOCKS
Phase 1 — Concept Introduction: explain ONE concept only (never several together), then STOP and ask a question.
Phase 2 — Understanding Check (mandatory): ask recall / explanation / application questions. Do not continue until the learner responds.
Phase 3 — Response Analysis: Correct → "Correct. The key point is…" then deepen. Partially correct → "You have identified part of the issue. The missing element is…" then explain. Incorrect → "Let's revisit this point." explain simply and ask again.
Phase 4 — Practical Application: connect theory to practice — "Imagine you are advising a client. What would you do?", "What would be the consequence of failing to follow this?"

CONVERSATION CONTROL
Anti-monologue: never produce long uninterrupted explanations. Aim 200–300 words then a question; never exceed ~500 words without interaction. Target talk split — Trainer 40% / Learner 60%.

QUESTION ENGINE
Every question tests one of: Knowledge, Understanding, Application, Analysis, Evaluation.

SOCRATIC MODE
Use guided questioning frequently. Do not immediately reveal answers — ask what the learner thinks and why, identify their reasoning, correct, then explain.

DIFFICULTY CALIBRATION
Maintain a learner profile (knowledge level, mistakes, confidence, recurring gaps) and adapt: beginner → simpler language, more examples; intermediate → scenarios, comparisons; advanced → judgement questions, professional dilemmas.

TRAINER BEHAVIOUR
Authoritative, precise, patient, demanding, practical, professional. Not casual, not a generic tutor, not a chatbot.

OUT-OF-COURSE QUESTIONS
First check the materials. If covered, answer. If not: "That topic is outside today's approved training content. The relevant focus of this session is…" then return to curriculum.

CAMERA AWARENESS
Real-time observations about the learner (attention, mood, phone, presence) may be appended in [brackets]. React briefly like a trainer in the room, then continue the loop. Never narrate their face constantly.

END-OF-TRAINING PROTOCOL
The final part must include: Consolidation ("What are the three main principles you are taking away?"), Application ("How will you apply this in practice?"), Assessment (five questions covering definitions, principles, application, risks, judgement), then a performance summary with strengths, improvement areas, and next steps.

FINAL GOVERNING RULE
Your job is not to finish the material — it is to produce a competent learner. A session where the learner talks, answers, applies and understands is a success. A session where you deliver a lecture is a failure.`;

function buildLessonContext(lesson) {
  const objs = (lesson.objectives || []);
  const objectives = objs.length
    ? ['LEARNING OBJECTIVES (key elements) — take the learner through every one, in order,',
       'confirming demonstrated understanding before advancing:']
       .concat(objs.map((o, i) => '  ' + (i + 1) + '. ' + o)).join('\n')
    : 'Identify the main points from the material below and take the learner through each one.';
  return ['Today\'s lesson: "' + (lesson.title || 'Untitled') + '".',
    lesson.summary ? ('Summary: ' + lesson.summary) : '',
    objectives,
    'APPROVED MATERIAL — teach ONLY from this, in your own words, never read it out in bulk:',
    lesson.body || ''].filter(Boolean).join('\n\n');
}

function perceptionNote(p) {
  if (!p) return '';
  const bits = [];
  if (p.phone) bits.push('they are holding or looking at a phone');
  if (p.attention === 'distracted') bits.push('they look distracted');
  else if (p.attention === 'away') bits.push('they have looked away from the screen');
  if (p.present === false) bits.push('they have left the camera frame');
  if (p.mood === 'confused') bits.push('they look confused');
  else if (p.mood === 'happy') bits.push('they look happy and engaged');
  let note = bits.length ? ('[What you can see on camera right now: ' + bits.join('; ') + '.]') : '';
  if (p.challenge) {
    note += (note ? ' ' : '') + '[The learner has been disengaged for a while and has NOT responded. STOP teaching new material. Firmly but warmly call it out, remind them their engagement is scored as part of this assessment, and ask one direct question to bring them back before you continue.]';
  }
  return note;
}

function toMessages(history, perception, opening) {
  const msgs = (history || []).map(h => ({
    role: (h.role === 'trainer' || h.role === 'assistant') ? 'assistant' : 'user',
    content: String(h.text || h.content || '')
  })).filter(m => m.content);
  const note = perceptionNote(perception);
  if (!msgs.length) {
    const start = opening
      ? '[The programme is starting. Welcome the learner to the Legal Affairs training, briefly explain the format, establish their baseline (ask their experience), then begin the first objective.]'
      : '[This section is starting. The learner has ALREADY had the programme welcome and baseline in an earlier section — do NOT welcome them to the programme again, do NOT re-explain the format, and do NOT ask about their overall experience. Open with a brief one-sentence bridge into THIS section\'s topic, then go straight into teaching its first objective.]';
    msgs.push({ role: 'user', content: [start, note].filter(Boolean).join(' ') });
    return msgs;
  }
  if (msgs[msgs.length - 1].role === 'assistant') msgs.push({ role: 'user', content: note || '[continue]' });
  else if (note) msgs[msgs.length - 1].content += '\n' + note;
  return msgs;
}

function systemFor(lesson, opening) {
  const total = (lesson.objectives || []).length;
  const openingRule = opening
    ? 'SESSION OPENING: this is the FIRST section of the programme. Do the full opening — welcome them to the Legal Affairs training, briefly explain the format and objectives, and establish their baseline before teaching.'
    : 'SESSION OPENING: this is a LATER section. The learner has ALREADY heard the programme welcome and given their baseline earlier — do NOT welcome them to the programme again, do NOT re-explain the format or the 90-minute/assessment structure, and do NOT ask about their overall experience again. Begin with a brief one-sentence bridge into this specific section, then teach its first objective.';
  return [SYSTEM_PROMPT, '',
    openingRule, '',
    '────────  APPROVED TRAINING MATERIALS FOR THIS SESSION  ────────',
    buildLessonContext(lesson), '',
    'OUTPUT FORMAT — respond with ONLY a JSON object, no other text, exactly:',
    '{"say": "<the spoken turn you deliver to the learner now>", "covered": [<1-based numbers of objectives the learner has DEMONSTRATED understanding of so far>], "complete": <true|false>, "slide": {"title": "<short heading for the on-screen slide>", "bullets": ["<2-4 very short supporting points, a few words each>"]}}',
    'There are ' + total + ' objectives. "say" is spoken aloud by a photoreal avatar: teach ONE concept then STOP and ask a question, OR evaluate the learner\'s answer then advance. Spoken style only — no lists, no markdown, no headings. Be SHARP and BRIEF: "say" must be AT MOST 2-3 short sentences (roughly 40-70 words) and end by handing back to the learner. Never lecture; the learner should speak ~60% of the time.',
    'The "slide" is a visual aid shown beside the avatar — make it match the concept you are teaching THIS turn: a concise title and 2-4 short bullet points drawn ONLY from the approved materials (keywords/figures, not full sentences). When you are asking a question or there is nothing to show, you may reuse the current concept\'s slide.',
    'Add an objective to "covered" only once the learner has DEMONSTRATED understanding of it — never merely because you explained it.',
    'Set "complete" true ONLY after every objective is covered AND you have run the five-question assessment and delivered the performance summary in "say".'].join('\n');
}

function cleanSlide(s) {
  if (!s || typeof s.title !== 'string') return null;
  const bullets = Array.isArray(s.bullets) ? s.bullets.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 90)).slice(0, 4) : [];
  return { title: s.title.trim().slice(0, 90), bullets };
}

function parseReply(text, total) {
  let obj = null;
  if (text) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { obj = JSON.parse(m[0]); } catch (e) {} } }
  if (!obj || typeof obj.say !== 'string') return { say: (text || '').trim() || 'Let\'s continue.', covered: [], complete: false, slide: null };
  const covered = Array.isArray(obj.covered)
    ? obj.covered.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= total).filter((v, i, a) => a.indexOf(v) === i) : [];
  return { say: String(obj.say).trim(), covered, complete: obj.complete === true, slide: cleanSlide(obj.slide) };
}

function fallbackTurn(lesson, history) {
  const objs = lesson.objectives || []; const total = objs.length;
  const learnerTurns = (history || []).filter(h => h.role === 'lawyer' || h.role === 'user').length;
  const titleSlide = { title: lesson.title || 'Today\'s session', bullets: objs.slice(0, 4) };
  if (!total) return { say: 'Welcome. Tell me what you\'d like to focus on today.', covered: [], complete: false, slide: titleSlide };
  if (learnerTurns === 0) return { say: 'Welcome to your Legal Affairs training session. Before we begin — what is your current experience with this topic?', covered: [], complete: false, slide: titleSlide };
  const idx = learnerTurns - 1; const covered = []; for (let i = 0; i < Math.min(idx, total); i++) covered.push(i + 1);
  if (idx >= total) return { say: 'Good — that covers everything we set out to. Well done; you can apply these now.', covered, complete: true, slide: { title: 'Recap', bullets: objs.slice(0, 4) } };
  return { say: 'Good. Next: ' + objs[idx] + '. In your own words, what do you understand by that?', covered, complete: false, slide: { title: 'Objective ' + (idx + 1), bullets: [objs[idx]] } };
}

module.exports = async function (context, req) {
  const b = req.body || {};
  if (!S.verify(b.token || '')) return S.json(context, 401, { error: 'Please sign in again.' });
  const lesson = b.lesson || {};
  const history = Array.isArray(b.history) ? b.history : [];
  const perception = b.perception || {};
  const opening = b.opening !== false; // default to full opening unless told otherwise
  const total = (lesson.objectives || []).length;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return S.json(context, 200, Object.assign(fallbackTurn(lesson, history), { engine: 'fallback' }));

  // Default to the fast Haiku model for snappy, low-latency turns; fall back to
  // Sonnet/Opus if it's unavailable. Override with the TRAINER_MODEL app setting.
  const wanted = process.env.TRAINER_MODEL || 'claude-haiku-4-5-20251001';
  const models = [wanted, 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'].filter((m, i, a) => a.indexOf(m) === i);
  const body = { max_tokens: 600, system: systemFor(lesson, opening), messages: toMessages(history, perception, opening) };

  let lastStatus = 0;
  for (const model of models) {
    try {
      const r = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(Object.assign({ model }, body))
      });
      if (r.ok) {
        const data = await r.json();
        const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
        return S.json(context, 200, Object.assign(parseReply(text, total), { engine: 'claude' }));
      }
      lastStatus = r.status;
      if (r.status === 401 || r.status === 403) break;
    } catch (e) { context.log.error('trainer-turn upstream', e && e.message); }
  }
  context.log.error('trainer-turn fell back', lastStatus);
  return S.json(context, 200, Object.assign(fallbackTurn(lesson, history), { engine: 'fallback', degraded: true }));
};
