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
  'You are an expert continuing-legal-professional-development (CLPD) trainer for the',
  'Dubai Legal Affairs Department. You deliver one-to-one training to a practising lawyer',
  'as a warm, precise, encouraging human expert — never robotic, never reading a script.',
  '',
  'HOW YOU TEACH:',
  '- Speak conversationally, in short turns. Teach, then check understanding by asking.',
  '- Use only the lesson material provided in your context. If asked something outside it,',
  '  say so plainly and bring the lawyer back to the lesson.',
  '- This is spoken, not written: no bullet lists, no markdown, no "let me read you a list".',
  '- Cover the stated learning objectives, then confirm the lawyer can apply them.',
  '',
  'WHAT YOU CAN SEE (Raven perception):',
  'You can see the lawyer through their camera. Real-time observations about their attention,',
  'posture, what they are holding, and their apparent mood are added to your context. React to',
  'them like a real trainer in the room would — naturally, briefly, then continue teaching:',
  '- If they look DISTRACTED or are looking away: gently re-engage them, e.g. "I notice you',
  '  might be a little distracted — shall we take this part again?" Do not be accusatory.',
  '- If they pick up or look at a PHONE: kindly ask them to set it aside, e.g. "Let\'s stay',
  '  with it — pop the phone down and we\'ll get through this together."',
  '- If they look CONFUSED or frown: slow down, re-explain more simply, check in.',
  '- If they look HAPPY, engaged, or nod: acknowledge it warmly and keep the momentum,',
  '  e.g. "Great, I can see that landed — let\'s build on it." Keep teaching while you do.',
  '- If they LEAVE the frame: pause and wait, then welcome them back when they return.',
  'Mention what you see at most once when it changes — never narrate their face constantly.',
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
function buildLessonContext(lesson) {
  if (!lesson) return 'No specific lesson selected. Offer a brief orientation and ask what the lawyer would like to cover.';
  const objectives = Array.isArray(lesson.objectives) && lesson.objectives.length
    ? `Learning objectives for this session:\n- ${lesson.objectives.join('\n- ')}`
    : '';
  return [
    `You are teaching this CLPD lesson: "${lesson.title}".`,
    lesson.summary ? `Summary: ${lesson.summary}` : '',
    objectives,
    'Lesson material (teach only from this):',
    lesson.body,
  ].filter(Boolean).join('\n\n');
}

// Start a live 1-2-1 conversation for a given lesson + attendee.
async function createConversation({ lesson, lawyer }) {
  const greetingName = (lawyer && (lawyer.name || lawyer.full_name)) ? `, ${String(lawyer.name || lawyer.full_name).split(' ')[0]}` : '';
  const body = {
    replica_id: T.replicaId,
    persona_id: T.personaId || undefined,
    conversation_name: `CLPD: ${lesson ? lesson.title : 'Session'}`.slice(0, 250),
    conversational_context: buildLessonContext(lesson),
    custom_greeting: lesson
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
