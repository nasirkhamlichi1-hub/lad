'use strict';

// The trainer's BRAIN for the scalable engine — Claude (Anthropic).
// ---------------------------------------------------------------------
// Given the lesson, the conversation so far, and what the camera currently
// sees, it returns the trainer's next short spoken turn PLUS structured signals
// so we can hard-track coverage of every key element:
//
//   { say: string, covered: number[], complete: boolean }
//
// covered  = 1-based indices of key elements taught AND understood so far
// complete = true only when every key element is done and recapped
//
// If ANTHROPIC_API_KEY is not set, a deterministic fallback walks the lawyer
// through the objectives one at a time, so the whole engine (and UI) still runs
// in demo mode without any external call.

const axios = require('axios');
const config = require('../config');
const log = require('../logger');
const aimodel = require('./aimodel');
const { SYSTEM_PROMPT, buildLessonContext } = require('./trainerPrompt');

const A = config.anthropic;
const B = config.trainerBrain;

function isConfigured() {
  return aimodel.configured() || !!A.apiKey;
}

// Render the current camera perception as a short note for the model.
function perceptionNote(p) {
  if (!p) return '';
  const bits = [];
  if (p.present === false) bits.push('the lawyer has stepped out of the camera frame');
  if (p.phone) bits.push('a phone is visible in their hand');
  if (p.attention === 'distracted') bits.push('they look distracted / are looking away');
  if (p.attention === 'away') bits.push('they are not looking at the screen');
  if (p.mood === 'confused') bits.push('they look a little confused');
  if (p.mood === 'happy') bits.push('they look happy and engaged');
  if (!bits.length) return '';
  return `[What you can see on camera right now: ${bits.join('; ')}.]`;
}

// The per-turn instruction appended to the shared teaching charter.
function systemFor(lesson, resume) {
  const total = (lesson && Array.isArray(lesson.objectives)) ? lesson.objectives.length : 0;
  const parts = [
    SYSTEM_PROMPT,
    '',
    buildLessonContext(lesson),
  ];
  if (resume && resume.context) {
    parts.push(
      '',
      '--- RESUMING A PREVIOUS SESSION ---',
      `The lawyer has already covered about ${Math.round(resume.percent || 0)}% of this lesson. Here is the recap so you can continue without repeating:`,
      resume.context,
      'Greet them back briefly, then continue from where they left off.'
    );
  }
  parts.push(
    '',
    'OUTPUT FORMAT — IMPORTANT:',
    'Respond with ONLY a JSON object, no other text, of exactly this shape:',
    '{"say": "<your short spoken turn>", "covered": [<1-based numbers of the key elements fully taught AND understood so far>], "complete": <true|false>}',
    `There are ${total} key elements. "say" must be short and conversational (one or two sentences).`,
    'Set "complete" to true ONLY after every key element is covered, understood, and you have given a one-line recap in "say".',
    'React naturally and briefly to any camera note before continuing to teach.'
  );
  return parts.join('\n');
}

function toMessages(history, perception) {
  const msgs = (history || []).map(h => ({
    role: (h.role === 'trainer' || h.role === 'assistant') ? 'assistant' : 'user',
    content: String(h.text || h.content || ''),
  })).filter(m => m.content);

  // The model needs a trailing user turn to respond to. On the very first turn
  // there is none, so seed one. Otherwise, attach the perception note to the
  // last user message (or add one if the last turn was the assistant's).
  const note = perceptionNote(perception);
  if (!msgs.length) {
    msgs.push({ role: 'user', content: ['[The session is starting. Greet the lawyer briefly and begin teaching the first key element.]', note].filter(Boolean).join(' ') });
    return msgs;
  }
  if (msgs[msgs.length - 1].role === 'assistant') {
    msgs.push({ role: 'user', content: note || '[continue]' });
  } else if (note) {
    msgs[msgs.length - 1].content += '\n' + note;
  }
  return msgs;
}

function parseReply(text, total) {
  let obj = null;
  if (text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch { /* fall through */ } }
  }
  if (!obj || typeof obj.say !== 'string') {
    return { say: (text || '').trim() || 'Let\'s continue.', covered: [], complete: false };
  }
  const covered = Array.isArray(obj.covered)
    ? obj.covered.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n >= 1 && n <= total)
    : [];
  return { say: String(obj.say).trim(), covered: [...new Set(covered)], complete: obj.complete === true };
}

// ─── Deterministic fallback (no API key) ─────────────────────────────
function fallbackTurn({ lesson, history, perception }) {
  const objectives = (lesson && Array.isArray(lesson.objectives)) ? lesson.objectives : [];
  const total = objectives.length;
  const lawyerTurns = (history || []).filter(h => h.role === 'lawyer' || h.role === 'user').length;
  const note = perception && (perception.phone || perception.attention === 'distracted' || perception.attention === 'away');
  const nudge = note ? 'I want to make sure this lands — let\'s keep our focus here for a moment. ' : '';

  if (!total) {
    return { say: 'Thanks for joining. Tell me what you\'d like to focus on today.', covered: [], complete: false };
  }
  if (lawyerTurns === 0) {
    return { say: `${nudge}Welcome — let's begin. ${objectives[0]}. In your own words, what do you understand by that?`, covered: [], complete: false };
  }
  const idx = lawyerTurns; // next element to introduce
  const covered = Array.from({ length: Math.min(idx, total) }, (_, i) => i + 1);
  if (idx >= total) {
    return { say: `${nudge}Good — that covers everything: ${objectives.map((o, i) => i + 1 + ') ' + o).join('; ')}. Well done; you can apply these now.`, covered, complete: true };
  }
  return { say: `${nudge}Good. Next: ${objectives[idx]}. How would you apply that?`, covered, complete: false };
}

// ─── Main entry ──────────────────────────────────────────────────────
async function nextTurn({ lesson, history, perception, resume }) {
  const total = (lesson && Array.isArray(lesson.objectives)) ? lesson.objectives.length : 0;

  if (!isConfigured()) {
    return { ...fallbackTurn({ lesson, history, perception }), engine: 'fallback' };
  }

  const system = systemFor(lesson, resume);
  const messages = toMessages(history, perception);

  // ─── Preferred: AiModel ───────────────────────────────────────────
  if (aimodel.configured()) {
    try {
      const text = await aimodel.chat({ system, messages, maxTokens: B.maxTokens, temperature: 0.5 });
      return { ...parseReply(text, total), engine: 'aimodel' };
    } catch (e) {
      log.error('trainer_brain_aimodel_failed', { error: e.message, detail: e.detail });
      if (!A.apiKey) return { ...fallbackTurn({ lesson, history, perception }), engine: 'fallback', degraded: true };
      // else fall through to Claude
    }
  }

  const body = {
    model: B.model,
    max_tokens: B.maxTokens,
    system,
    messages,
  };

  const r = await axios.post(`${A.baseUrl || 'https://api.anthropic.com'}/v1/messages`, body, {
    headers: {
      'x-api-key': A.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    timeout: 30000,
    validateStatus: () => true,
  });

  if (r.status >= 300) {
    log.error('trainer_brain_failed', { status: r.status, detail: r.data });
    // Degrade gracefully rather than breaking the session.
    return { ...fallbackTurn({ lesson, history, perception }), engine: 'fallback', degraded: true };
  }

  const text = (r.data && Array.isArray(r.data.content) && r.data.content[0] && r.data.content[0].text) || '';
  return { ...parseReply(text, total), engine: 'claude' };
}

module.exports = { isConfigured, nextTurn, perceptionNote, parseReply, systemFor };
