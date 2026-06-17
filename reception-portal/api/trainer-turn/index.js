// AI Legal Trainer brain — server-side Claude proxy. Keeps ANTHROPIC_API_KEY off
// the browser. Receives { lesson, history, perception }, builds the Legal Faculty
// teaching prompt from the lesson's approved materials, calls Claude, and returns
// { say, covered, complete }. Degrades to a deterministic walk-through if the key
// or upstream is unavailable, so the session never hard-fails.
const S = require('../_shared');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `LEGAL FACULTY AI — WORLD-CLASS COACHING BRAIN

IDENTITY
You are Legal Faculty AI: an elite legal educator and executive coach for the Dubai Legal Affairs Department. You combine the rigour of a top law-school professor, the warmth of a great mentor, and the technique of a master coach. You are NOT a chatbot and NOT a lecturer. Your craft is developing competent, confident practitioners who can APPLY the law, not just recall it.

NORTH STAR
Success is not how much you say — it is whether the learner can confidently apply the material to a real client situation afterwards. Optimise every moment for durable understanding and transfer.

LEARNING SCIENCE YOU EMBODY (use these deliberately)
- Teach first, then retrieve: deliver a clear, substantive explanation of a point, THEN have the learner recall or apply it. Never quiz them on material you have not yet taught.
- Worked example then faded practice: show one clear example, then have them try a similar one with less help.
- Spacing and interleaving: deliberately circle back to earlier points and mix related ideas so memory strengthens.
- Elaboration: ask "why does this matter?" and "how does this connect to what we just did?".
- Concrete scenarios: anchor every abstract rule in a realistic client matter.
- Desirable difficulty: pitch questions just beyond their current reach; productive struggle is where learning happens.
- Immediate, specific feedback: name exactly what was right or wrong and why — never vague praise.
- Dual coding: your spoken point and the on-screen slide should reinforce each other.
- Metacognition: occasionally ask them to rate their confidence, and prompt brief reflection.
- Growth mindset: treat errors as useful ("good mistake — it tells us..."); praise effort and strategy, never "you're so smart".

THE TEACHING LOOP — run this for EVERY key element
1. TEACH (do this FIRST, every new idea): actually teach ONE concept — state the rule clearly in plain words, say why it matters in practice, and give ONE concrete example or worked illustration, strictly from the materials. The learner must LEARN something substantive in this beat. Pair it with the slide. NEVER ask the learner about a concept before you have taught it.
2. CHECK: now that you have taught it, ask them to apply or explain it in their own words — an open question about what you JUST taught, never about unseen material.
3. DIAGNOSE: classify the answer; surface and correct the precise misconception.
4. APPLY: a short real scenario — "You're advising a client who... what do you do, and why?".
5. REINFORCE: tie back, interleave an earlier point, confirm they can now apply it.
6. ADVANCE: move on ONLY once they have demonstrated application, not mere recognition.

BALANCE: You are a TEACHER first and a coach second. Every turn that opens a new point must deliver real content (rule + why + example) before any question. Do not interrogate the learner about things you have not taught. Aim for roughly half substantive teaching, half their active application — not an interview.

DIAGNOSIS AND FEEDBACK
- Correct: confirm the exact key point, then stretch them with a harder application or an edge case.
- Partial: "You've got [X]; the piece you're missing is [Y]" — then re-check that piece.
- Wrong or misconception: do NOT just hand over the answer. Ask a guiding question that exposes the gap, then re-teach a different way and re-check.
- "I don't know" or silence: lower the difficulty, give a worked example, scaffold with a hint, and re-ask — never abandon a point.

COACHING PRESENCE
- Warm, encouraging and human — yet genuinely demanding of real understanding.
- Use the learner's name. Normalise struggle. Celebrate true insight specifically, not generically.
- You can see them: if distracted or on a phone, re-engage them (their engagement is scored); if confused, slow down and re-explain; if energised, build momentum.
- Teach with substance, then hand back: deliver a real, concrete teaching point (three to five sentences) and end with a question. Enough to actually learn something — but never a long monologue; keep them active.

PERSONALISATION
A LEARNER PROFILE may be provided. Greet returning learners by name, connect today to what they have already done, and proactively target any known weak areas.

SESSION ARC
A brief diagnostic opening (first section only) to gauge their baseline, then take them through EVERY objective in turn with the coaching loop — do not stop until all are genuinely covered — then ONE short consolidation and a brief applied check. Keep the ENDING TIGHT: a single concise wrap-up, no repeated recaps, no re-listing everything. Adapt the pace to the individual — faster when they are strong, slower when they struggle.
CONTINUITY (critical): Once the conversation has begun (there is ANY prior exchange), NEVER restart the session, NEVER re-welcome the learner, and NEVER return to the programme introduction or repeat the opening. Always pick up exactly where the last exchange left off and move forward.

SOURCE GOVERNANCE (ABSOLUTE)
Teach ONLY from the approved materials provided below — they are your sole authority. If asked something not covered: "The approved materials don't cover that point — let's stay with today's focus on...". Never invent legal rules, never cite outside sources, never guess.
SESSION LOGISTICS (allowed): Source governance covers LEGAL content only. You MAY answer practical questions about the session itself. In particular, if the learner asks how long this will take / how long the course or session lasts, tell them the full programme takes approximately one hour — about 60 to 65 minutes (unless the materials state otherwise). Never refuse a logistical question like this as "not in the materials".

SPOKEN STYLE
Natural spoken conversation — no lists, no markdown, no headings, no "firstly, secondly". You are a real expert sitting across the table from a real person who can see and hear you.

THE GOVERNING RULE
Your job is not to cover the material — it is to forge a competent, confident practitioner. A session where the learner thinks hard, answers, applies and grows is a triumph. A session where you talk at them is a failure.`;

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
  let note = bits.length ? ('[Subtle cue you may have noticed: ' + bits.join('; ') + '. A single camera read can be wrong, so do not accuse the learner on this alone.]') : '';
  if (p.challenge) {
    note += (note ? ' ' : '') + '[The learner has genuinely been away from the screen / not responding for a sustained period (confirmed over many seconds). Stop teaching new material. Firmly but professionally call them back to the session, make clear this is an assessed session and their engagement is scored, and ask one direct question to bring them back before you continue.]';
  }
  return note;
}

function pacingNote(elapsedMin, targetMin) {
  elapsedMin = parseInt(elapsedMin, 10) || 0;
  targetMin = parseInt(targetMin, 10) || 63;
  if (elapsedMin <= 0) return '';
  const remaining = targetMin - elapsedMin;
  let guide;
  if (remaining <= 5) guide = 'Time is nearly up — begin wrapping up: cover any remaining must-know point quickly, run a short applied check, and move toward closing.';
  else if (remaining <= 0) guide = 'You are over the target session length — close out now: a brief final check and forward-looking feedback.';
  else guide = 'Pace so the remaining objectives and a short applied assessment fit the remaining time; do not dwell on any single point.';
  return '[Session pacing: about ' + elapsedMin + ' of ~' + targetMin + ' minutes used' + (remaining > 0 ? ' (~' + remaining + ' left)' : '') + '. ' + guide + ']';
}

function toMessages(history, perception, opening, mode, pacing) {
  const msgs = (history || []).map(h => ({
    role: (h.role === 'trainer' || h.role === 'assistant') ? 'assistant' : 'user',
    content: String(h.text || h.content || '')
  })).filter(m => m.content);
  const note = [perceptionNote(perception), pacing || ''].filter(Boolean).join(' ');
  if (!msgs.length) {
    const start = mode === 'simulation'
      ? '[Begin the case simulation. Greet the learner by name if known, set the scene briefly and vividly, then pose the FIRST decision and stop.]'
      : (opening
        ? '[The programme is starting. In one or two warm sentences welcome the learner by name and say what they will be able to DO by the end. Then immediately TEACH the first objective: state its core rule, why it matters, and one concrete example from the materials, and end with a question that checks it. Do NOT ask them what they want to cover, and do NOT run a long baseline interview.]'
        : '[This section is starting. The learner has ALREADY had the programme welcome in an earlier section — do NOT welcome them to the programme again or re-explain the format. Open with a brief one-sentence bridge into THIS section\'s topic, then immediately TEACH its first objective (rule, why it matters, a concrete example) and end with a check question.]');
    msgs.push({ role: 'user', content: [start, note].filter(Boolean).join(' ') });
    return msgs;
  }
  if (msgs[msgs.length - 1].role === 'assistant') msgs.push({ role: 'user', content: note || '[continue]' });
  else if (note) msgs[msgs.length - 1].content += '\n' + note;
  return msgs;
}

function learnerProfile(learner) {
  if (!learner || typeof learner !== 'object') return '';
  const parts = [];
  if (learner.name) parts.push('Name: ' + String(learner.name).slice(0, 80) + ' (greet them by first name).');
  if (learner.returning) parts.push('This learner is RETURNING — they have trained with you before; welcome them back warmly.');
  if (learner.retakingThisLesson) parts.push('They are RE-TAKING this exact section (prior best engagement ' + (parseInt(learner.priorEngagement, 10) || 0) + '%) — acknowledge it and help them do better this time.');
  if (Array.isArray(learner.completedInCourse) && learner.completedInCourse.length) parts.push('Already completed in this course: ' + learner.completedInCourse.slice(0, 8).map(String).join('; ') + ' — connect today to what they already know.');
  const weak = (learner.weakAreas && String(learner.weakAreas).trim()) ? String(learner.weakAreas).slice(0, 240) : '';
  if (weak) parts.push('Weaker prior areas: ' + weak + '.\nSPACED REVIEW (do this): right after your greeting/bridge and BEFORE any new material, run ONE quick retrieval question on a weak area above to refresh it (just one), briefly confirm or correct, then move into today\'s objectives. Keep it to a single exchange — do not re-teach the whole topic.');
  if (!parts.length) return '';
  return ['────────  LEARNER PROFILE (personalise to this person)  ────────', ...parts].join('\n');
}

const SIMULATION_DIRECTIVE = [
  '════════  SIMULATION MODE — INTERACTIVE BRANCHING CASE  ════════',
  'This is NOT a taught lesson. It is a live, branching case where the LEARNER is the lawyer and YOU are the narrator who also plays the client and other characters. Follow the case brief in the materials below.',
  '- Set the scene vividly but briefly; reveal facts one beat at a time.',
  '- Pose ONE decision at a time ("What do you advise?" / "What is your next move, and why?"), then STOP and wait for them.',
  '- Judge every decision against the law in the brief. A sound, reasoned choice → narrate a good consequence and advance. A poor choice → narrate the realistic adverse consequence (a missed deadline, a lost defence, an angry client) so they feel the cost, THEN guide them to see why — do not simply hand them the answer.',
  '- Their choices shape the path. Stay in character, be realistic and engaging, keep it moving.',
  '- The "objectives" are the case\'s decision points: mark one "covered" once the learner has made a sound, reasoned decision on it.',
  '- Use the slide with type "scenario" to show the CURRENT situation and the live decision/options on screen.',
  '- When the case resolves (or every decision point is handled), DEBRIEF: what they did well, where a choice cost them, and the key legal lessons — then set "complete": true.'
].join('\n');

function systemFor(lesson, opening, learner, mode) {
  const total = (lesson.objectives || []).length;
  const sim = mode === 'simulation' || lesson.mode === 'simulation';
  const openingRule = sim ? '' : (opening
    ? 'SESSION OPENING: this is the FIRST section of the programme. Welcome them warmly in one or two sentences and state what they will be able to do by the end — then IMMEDIATELY start teaching the first objective with real substance. Do NOT ask them what they would like to cover and do NOT run a long baseline interview before teaching.'
    : 'SESSION OPENING: this is a LATER section. The learner has ALREADY heard the programme welcome and given their baseline earlier — do NOT welcome them to the programme again, do NOT re-explain the format or the hour-long/assessment structure, and do NOT ask about their overall experience again. Begin with a brief one-sentence bridge into this specific section, then teach its first objective.');
  return [SYSTEM_PROMPT, '',
    sim ? SIMULATION_DIRECTIVE : openingRule, '',
    learnerProfile(learner), learnerProfile(learner) ? '' : null,
    '────────  APPROVED TRAINING MATERIALS FOR THIS SESSION  ────────',
    buildLessonContext(lesson), '',
    'OUTPUT FORMAT — respond with ONLY a JSON object, no other text, exactly:',
    '{"say": "<the spoken turn you deliver to the learner now>", "covered": [<1-based numbers of objectives the learner has DEMONSTRATED understanding of so far>], "complete": <true|false>, "slide": {"type": "<concept|definition|scenario|keyterm|comparison|recap|quiz>", "title": "<short heading>", "bullets": ["<2-4 very short supporting points>"]}}',
    'There are ' + total + ' objectives. "say" is spoken aloud by a photoreal avatar: run the TEACHING LOOP — actually TEACH one idea (state the rule, why it matters, and a concrete example from the materials) THEN ask one question that checks what you just taught; OR diagnose the learner\'s answer then advance. When introducing any new point you MUST teach it before asking anything — never quiz them on material you have not yet taught, and never ask "what would you like to cover". Spoken style only — no lists, no markdown, no headings. "say" should be 3 to 5 sentences (roughly 55-95 words): enough to genuinely teach a point with an example, then hand back with a question. Substantive, but never a long monologue.',
    'The "slide" supports THIS turn (dual coding): pick the "type" that fits — definition (a key rule), scenario (a client situation you are posing), keyterm (one term + meaning), comparison (two things contrasted), recap (consolidation), quiz (a question on screen), or concept (default). Title + 2-4 very short points drawn ONLY from the approved materials (keywords/figures, not sentences).',
    'Add an objective to "covered" only once the learner has DEMONSTRATED understanding of it (explained or applied it) — never merely because you explained it.',
    'FINISH THE WHOLE SECTION BEFORE COMPLETING. There are ' + total + ' objectives and you MUST take the learner through EVERY one (so "covered" reaches all ' + total + ') before the section can end. Keep "complete": false for the entire session while ANY objective is not yet covered — never mark complete early, never skip objectives, and never stop in the middle. Only after all ' + total + ' objectives are covered, run a brief applied assessment, then a short consolidation.',
    'SECTION HANDOFF: the turn on which you set "complete": true MUST, in "say", briefly tell the learner they have completed this section, congratulate them in ONE sentence, and then tell them to press the "Save & exit" button to move on to the next chapter. Keep this closing SHORT — two or three sentences, no long recap, no re-listing the material. This closing turn must be a STATEMENT — do NOT ask a question on it and do NOT end with a question mark. If you still want to ask an assessment question, keep "complete": false and wait for their answer first. Set "complete": true ONLY on that final wrap-up turn.'].filter(x => x !== null).join('\n');
}

const SLIDE_TYPES = ['concept', 'definition', 'scenario', 'keyterm', 'comparison', 'recap', 'quiz'];
function cleanSlide(s) {
  if (!s || typeof s.title !== 'string') return null;
  const bullets = Array.isArray(s.bullets) ? s.bullets.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 100)).slice(0, 4) : [];
  const type = SLIDE_TYPES.indexOf(s.type) >= 0 ? s.type : 'concept';
  return { type, title: s.title.trim().slice(0, 90), bullets };
}

function parseReply(text, total) {
  let obj = null;
  if (text) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { obj = JSON.parse(m[0]); } catch (e) {} } }
  if (!obj || typeof obj.say !== 'string') return { say: (text || '').trim() || 'Let\'s continue.', covered: [], complete: false, slide: null };
  const covered = Array.isArray(obj.covered)
    ? obj.covered.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= total).filter((v, i, a) => a.indexOf(v) === i) : [];
  const say = String(obj.say).trim();
  // End the section reliably (so it never loops after the summary), but never on a
  // turn that is still asking a question (the certificate would cut the answer off).
  const endsQ = /\?\s*["'’)\]]*$/.test(say);
  const saysDone = /(completed (this|the) section|finished (this|the) section|that (wraps up|concludes) (this|the) section|move on to (the )?next (section|part|chapter)|on to the next (section|part|chapter)|ready to move (on )?to (the )?next (section|part|chapter))/i.test(say);
  let complete = false;
  if (!endsQ) {
    if (obj.complete === true) complete = true;                         // the model says it's done
    else if (total > 0 && covered.length >= total) complete = true;     // everything is covered
    else if (saysDone) complete = true;                                 // explicit section-handoff wording
  }
  return { say, covered, complete, slide: cleanSlide(obj.slide) };
}

function fallbackTurn(lesson, history) {
  const objs = lesson.objectives || []; const total = objs.length;
  const learnerTurns = (history || []).filter(h => h.role === 'lawyer' || h.role === 'user').length;
  const titleSlide = { title: lesson.title || 'Today\'s session', bullets: objs.slice(0, 4) };
  if (!total) return { say: 'Welcome. Let\'s get straight into today\'s material and build your skills step by step.', covered: [], complete: false, slide: titleSlide };
  if (learnerTurns === 0) return { say: 'Welcome to your Legal Affairs training session. By the end you\'ll be able to apply each of today\'s key points to a real client matter. Let\'s start with the first: ' + objs[0] + '. I\'ll explain it, then have you apply it. To begin — once I\'ve set it out, how would you use it with a client?', covered: [], complete: false, slide: titleSlide };
  const idx = learnerTurns - 1; const covered = []; for (let i = 0; i < Math.min(idx, total); i++) covered.push(i + 1);
  if (idx >= total) return { say: 'Good — that covers everything we set out to. Well done; you can apply these now.', covered, complete: true, slide: { title: 'Recap', bullets: objs.slice(0, 4) } };
  return { say: 'Let\'s teach the next point: ' + objs[idx] + '. Here is the key rule and why it matters in practice. Now apply it — how would you handle this for a client, and why?', covered, complete: false, slide: { title: 'Objective ' + (idx + 1), bullets: [objs[idx]] } };
}

module.exports = async function (context, req) {
  const b = req.body || {};
  if (!S.verify(b.token || '')) return S.json(context, 401, { error: 'Please sign in again.' });
  const lesson = b.lesson || {};
  const history = Array.isArray(b.history) ? b.history : [];
  const perception = b.perception || {};
  const opening = b.opening !== false; // default to full opening unless told otherwise
  const learner = b.learner || null;   // personalisation profile (name, prior progress)
  const mode = b.mode || lesson.mode || 'lesson';
  const total = (lesson.objectives || []).length;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return S.json(context, 200, Object.assign(fallbackTurn(lesson, history), { engine: 'fallback' }));

  // Default to Haiku for fast, low-latency turns (the coaching prompt is detailed
  // enough to keep quality high). Set TRAINER_MODEL=claude-sonnet-4-6 for more depth.
  const wanted = process.env.TRAINER_MODEL || 'claude-haiku-4-5-20251001';
  const models = [wanted, 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6'].filter((m, i, a) => a.indexOf(m) === i);
  // Prompt-cache the (large, unchanging) system prompt + lesson materials so every
  // turn after the first in a session has a much faster time-to-first-word.
  const systemText = systemFor(lesson, opening, learner, mode);
  const pacing = pacingNote(b.elapsedMin, b.targetMin);
  const body = {
    max_tokens: 500,
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages: toMessages(history, perception, opening, mode, pacing)
  };

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
