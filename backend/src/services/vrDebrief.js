'use strict';

// VR client interview — the debrief.
// ---------------------------------------------------------------------
// When the interview ends the headset sends the transcript it heard (the
// lawyer's lines and the client's). Claude marks it against four interview
// skills and returns one strength and one thing to work on. Nothing is
// stored here; the route decides what to keep.

const axios = require('axios');
const config = require('../config');
const log = require('../logger');
const aimodel = require('./aimodel');

const A = config.anthropic;

const SKILLS = ['Building rapport', 'Fact finding', 'Explaining fees and next steps', 'Professional conduct'];

const SYSTEM = [
  'You assess a practising lawyer after a simulated first interview with a client.',
  'You are given the transcript: LAWYER is the trainee, CLIENT is the simulated client.',
  'Mark only what the transcript shows. If the interview was too short to judge a skill, give it a low score and say so.',
  'Reply with JSON only, no prose and no code fence, in exactly this shape:',
  '{"skills":[{"name":"<skill>","score":<integer 0-10>,"note":"<one short sentence>"}],"strength":"<one sentence>","improve":"<one sentence>"}',
  'The skills, in this order: ' + SKILLS.join('; ') + '.',
  'Write in the language the lawyer spoke. Address the lawyer as "you".',
].join('\n');

function isConfigured() {
  return aimodel.configured() || !!A.apiKey;
}

function transcriptText(turns) {
  return (Array.isArray(turns) ? turns : [])
    .filter((t) => t && typeof t.content === 'string' && t.content.trim())
    .slice(-120)
    .map((t) => (t.role === 'user' ? 'LAWYER: ' : 'CLIENT: ') + t.content.trim().slice(0, 1200))
    .join('\n');
}

// Tolerant of a stray fence or a sentence around the JSON.
function parse(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch (_) { return null; }
  if (!j || !Array.isArray(j.skills)) return null;
  const skills = SKILLS.map((name, i) => {
    const s = j.skills.find((x) => x && x.name === name) || j.skills[i] || {};
    const score = Math.max(0, Math.min(10, Math.round(Number(s.score) || 0)));
    return { name, score, note: String(s.note || '').slice(0, 200) };
  });
  return { skills, strength: String(j.strength || '').slice(0, 240), improve: String(j.improve || '').slice(0, 240) };
}

async function assess(turns) {
  const transcript = transcriptText(turns);
  if (!transcript) {
    const err = new Error('Nothing was said, so there is nothing to mark.');
    err.status = 400;
    throw err;
  }
  const messages = [{ role: 'user', content: 'Transcript:\n' + transcript }];
  let text = '';
  if (aimodel.configured()) {
    text = await aimodel.chat({ system: SYSTEM, messages, maxTokens: 600, temperature: 0.2 });
    if (text && typeof text === 'object') text = text.text || text.content || '';
  } else {
    const r = await axios.post(`${A.baseUrl || 'https://api.anthropic.com'}/v1/messages`,
      { model: A.model, max_tokens: 600, system: SYSTEM, messages },
      {
        headers: {
          'x-api-key': A.apiKey,
          ...(A.workspaceId ? { 'anthropic-workspace-id': A.workspaceId } : {}),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
      });
    if (r.status >= 300) {
      log.error('vr_debrief_failed', { status: r.status, detail: r.data });
      const err = new Error('The debrief could not be written.');
      err.status = 502;
      throw err;
    }
    text = (r.data && Array.isArray(r.data.content) && r.data.content[0] && r.data.content[0].text) || '';
  }
  const out = parse(text);
  if (!out) {
    log.error('vr_debrief_unreadable', { sample: String(text).slice(0, 200) });
    const err = new Error('The debrief could not be read.');
    err.status = 502;
    throw err;
  }
  return out;
}

module.exports = { isConfigured, assess, parse, transcriptText, SKILLS };
