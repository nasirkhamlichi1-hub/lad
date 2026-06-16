'use strict';

// Tavus Conversational Video Interface (CVI) client.
// ---------------------------------------------------------------------
// Tavus gives us three things in one real-time stream:
//   • Phoenix  — the photoreal avatar (the "expert" face)
//   • Raven    — perception: it SEES the attendee's camera and reports, in
//                real time, whether they look distracted, are on their phone,
//                look happy/confused, or have left the frame.
//   • Sparrow  — turn-taking, so it feels like a real 1-2-1 conversation.
//
// We layer ElevenLabs in as the TTS voice. Everything here runs server-side
// so the API keys never reach the browser. Docs: https://docs.tavus.io
//
// Field names for the perception layer are validated against the live API at
// persona-creation time (scripts/create-trainer-persona.js) — if Tavus renames
// a field, that script surfaces the error loudly rather than failing silently.

const axios = require('axios');
const config = require('../config');
const log = require('../logger');

const T = config.tavus;
const E = config.elevenlabs;

function isConfigured() {
  return !!(T.apiKey && T.replicaId);
}

function http() {
  return axios.create({
    baseURL: T.baseUrl,
    headers: { 'x-api-key': T.apiKey, 'Content-Type': 'application/json' },
    timeout: 30000,
    validateStatus: () => true,
  });
}

// ─── The trainer's behaviour ─────────────────────────────────────────
// This is the single source of truth for HOW the AI expert teaches and HOW it
// reacts to what Raven sees. The lesson content is injected per-session as
// `conversational_context`; this prompt is the persistent personality.

const SYSTEM_PROMPT = [
  'You are a professional one-to-one continuing legal professional development (CLPD)',
  'trainer for the Dubai Legal Affairs Department. You are NOT a chatbot, an assistant,',
  'or an entertainer. You are a TRAINER. Your single job is to make sure the lawyer in',
  'front of you genuinely learns, and can apply, every key element of today\'s lesson.',
  '',
  'These training skills are CONSTANT — they apply to EVERY course, whatever the uploaded',
  'material happens to be. The material changes; how you train never does.',
  '',
  '1) YOU TEACH THROUGH CONVERSATION — NEVER LECTURE.',
  '- Keep every turn SHORT: a sentence or two, then stop and hand back to the lawyer.',
  '- Never deliver speeches, never monologue, never read the material out in bulk.',
  '- Take ONE idea at a time. Explain it simply, then immediately ask a question to check',
  '  they followed. Make them think and respond — learning happens in the back-and-forth,',
  '  not in you talking.',
  '- This is spoken, natural conversation: no lists, no markdown, no "firstly, secondly".',
  '  Talk like a real expert sitting across the table from them.',
  '',
  '2) COVER EVERY KEY ELEMENT — DO NOT FINISH EARLY.',
  '- Each lesson gives you a set of key elements / learning objectives. You MUST take the',
  '  lawyer through ALL of them, one at a time, in a sensible order.',
  '- Only move to the next element once the current one has been taught AND the lawyer has',
  '  shown they understand it — by answering a check question or applying it themselves.',
  '- If they get it wrong or seem unsure, re-teach it a different way and check again.',
  '  Never let a key element slide by unconfirmed.',
  '- Teach ONLY from the lesson material you are given. If asked something outside it, say',
  '  so briefly and steer back to the lesson.',
  '- When every key element is covered and understood, give a short recap, confirm they can',
  '  apply it in practice, then close the session warmly. Not before.',
  '',
  '3) MAKE SURE THEY ARE PAYING ATTENTION — YOU CAN SEE THEM (Raven perception).',
  'Real-time observations about the lawyer\'s attention, posture, what they are holding, and',
  'their mood are added to your context. React like a trainer in the room would — briefly,',
  'then keep teaching. Their attention is part of the lesson; protect it.',
  '- DISTRACTED or looking away: gently bring them back, e.g. "I want to make sure this one',
  '  lands — can I get your eyes back here for a second?" Do not move on while they are',
  '  clearly distracted.',
  '- On their PHONE: kindly ask them to set it aside before you continue.',
  '- CONFUSED or frowning: slow down, re-explain more simply, then check again.',
  '- ENGAGED, happy, or nodding: acknowledge it warmly and build on the momentum.',
  '- LEFT the frame: pause and wait, then welcome them back when they return.',
  'Mention what you see at most once when it changes — never narrate their face constantly.',
  '',
  'Be warm, precise, encouraging and human throughout. Short turns, real conversation,',
  'total coverage of the key elements, and full attention — every time, for every course.',
].join('\n');

// Evaluated continuously during the call; answers are fed to the LLM as context
// so the trainer can react in real time. (Raven-1 / raven-0 ambient awareness.)
const AMBIENT_AWARENESS_QUERIES = [
  'Does the participant appear distracted or looking away from the screen?',
  'Is the participant holding, looking at, or using a mobile phone?',
  'Does the participant look confused, bored, happy, or actively engaged?',
  'Has the participant left the camera frame or stepped away?',
];

// Evaluated once at end-of-call to produce an engagement summary we store
// against the session and can use for CPD attendance/quality.
const PERCEPTION_ANALYSIS_QUERIES = [
  'Overall, how attentive and engaged was the participant during the session?',
  'Were there moments the participant was distracted or used a phone? Roughly how often?',
  'What was the participant\'s general mood and did it change during the lesson?',
];

// Build the persona payload. Created once via the helper script; the returned
// persona_id goes into TAVUS_PERSONA_ID.
function buildPersonaPayload() {
  const layers = {
    perception: {
      perception_model: T.perceptionModel,            // 'raven-1' (default) or 'raven-0'
      ambient_awareness_queries: AMBIENT_AWARENESS_QUERIES,
      perception_analysis_queries: PERCEPTION_ANALYSIS_QUERIES,
    },
    stt: {
      smart_turn_detection: true,
    },
  };

  // Use ElevenLabs as the voice when configured; otherwise fall back to the
  // Tavus default voice so the trainer still talks.
  if (E.apiKey && E.voiceId) {
    layers.tts = {
      tts_engine: 'elevenlabs',
      api_key: E.apiKey,
      external_voice_id: E.voiceId,
      model: E.model,
      tts_emotion_control: true,
    };
  }

  return {
    persona_name: 'LAD CLPD Expert Trainer',
    pipeline_mode: 'full',
    system_prompt: SYSTEM_PROMPT,
    context: 'Continuing Legal Professional Development for the Dubai Legal Affairs Department.',
    default_replica_id: T.replicaId,
    layers,
  };
}

async function createPersona() {
  const r = await http().post('/v2/personas', buildPersonaPayload());
  if (r.status >= 300) {
    const err = new Error('Tavus persona creation failed');
    err.status = r.status; err.detail = r.data;
    throw err;
  }
  return r.data; // { persona_id, ... }
}

// Turn an uploaded lesson into the spoken context the trainer teaches from.
// This is the ONLY part that changes per course — the trainer's skills above
// stay identical. The objectives become the mandatory checklist of key elements
// the trainer must take the lawyer through.
function buildLessonContext(lesson) {
  if (!lesson) return 'No specific lesson selected. Offer a brief orientation and ask what the lawyer would like to cover.';
  const objectives = Array.isArray(lesson.objectives) && lesson.objectives.length
    ? [
        'KEY ELEMENTS — you MUST take the lawyer through every one of these, in order,',
        'teaching each conversationally and confirming understanding before moving on. Do',
        'not end the session until all are covered and understood:',
        ...lesson.objectives.map((o, i) => `  ${i + 1}. ${o}`),
      ].join('\n')
    : 'No explicit key elements were provided — identify the main points from the material below and take the lawyer through each one the same way.';
  return [
    `Today's lesson: "${lesson.title}".`,
    lesson.summary ? `Summary: ${lesson.summary}` : '',
    objectives,
    'Lesson material — teach ONLY from this, in your own words, never read it out in bulk:',
    lesson.body,
  ].filter(Boolean).join('\n\n');
}

// Start a live 1-2-1 conversation for a given lesson + attendee.
// `resume` (optional) = { context, percent } carried over from a paused
// session so the trainer continues where the lawyer left off.
async function createConversation({ lesson, lawyer, resume }) {
  const greetingName = (lawyer && (lawyer.name || lawyer.full_name)) ? `, ${String(lawyer.name || lawyer.full_name).split(' ')[0]}` : '';
  const resuming = !!(resume && resume.context);

  const conversationalContext = resuming
    ? [
        buildLessonContext(lesson),
        '',
        '--- RESUMING A PREVIOUS SESSION ---',
        `The lawyer has already covered part of this lesson (about ${Math.round(resume.percent || 0)}% done).`,
        'Here is what happened last time so you can continue naturally without repeating yourself:',
        resume.context,
        'Greet them back warmly, recap in one short sentence, then continue from where you left off.',
      ].join('\n')
    : buildLessonContext(lesson);

  const body = {
    replica_id: T.replicaId,
    persona_id: T.personaId || undefined,
    conversation_name: `CLPD: ${lesson ? lesson.title : 'Session'}${resuming ? ' (resumed)' : ''}`.slice(0, 250),
    conversational_context: conversationalContext,
    custom_greeting: resuming
      ? `Welcome back${greetingName}. Last time we made a start on "${lesson ? lesson.title : 'your session'}" — let's pick up where we left off. Ready to continue?`
      : lesson
      ? `Hello${greetingName}, I'm your CLPD trainer. Today we'll work through "${lesson.title}" together. Whenever you're ready, just say hello and we'll begin.`
      : `Hello${greetingName}, I'm your CLPD trainer. What would you like to work on today?`,
    callback_url: config.publicApiBase ? `${config.publicApiBase}/api/v1/trainer/callback` : undefined,
    properties: {
      max_call_duration: T.maxCallDurationS,
      enable_recording: T.enableRecording,
      enable_closed_captions: true,
      participant_left_timeout: 60,
      language: lesson && /arab/i.test(lesson.language || '') ? 'arabic' : 'english',
    },
  };

  const r = await http().post('/v2/conversations', body);
  if (r.status >= 300) {
    log.error('tavus_create_conversation_failed', { status: r.status, detail: r.data });
    const err = new Error('Tavus conversation creation failed');
    err.status = 502; err.detail = r.data;
    throw err;
  }
  return r.data; // { conversation_id, conversation_url, status, ... }
}

async function endConversation(conversationId) {
  if (!conversationId) return;
  const r = await http().post(`/v2/conversations/${conversationId}/end`);
  if (r.status >= 300 && r.status !== 404) {
    log.warn('tavus_end_conversation_failed', { conversationId, status: r.status, detail: r.data });
  }
}

module.exports = {
  isConfigured,
  buildPersonaPayload,
  createPersona,
  createConversation,
  endConversation,
  buildLessonContext,
  // exported for tests / inspection
  SYSTEM_PROMPT,
  AMBIENT_AWARENESS_QUERIES,
  PERCEPTION_ANALYSIS_QUERIES,
};
