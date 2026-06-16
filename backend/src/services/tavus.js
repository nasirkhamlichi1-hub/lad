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
// The teaching charter, perception queries and lesson framing live in
// services/trainerPrompt.js so they are SHARED with the Claude brain (the
// scalable engine). This file maps that charter onto the Tavus persona.
const {
  SYSTEM_PROMPT,
  AMBIENT_AWARENESS_QUERIES,
  PERCEPTION_ANALYSIS_QUERIES,
  buildLessonContext,
} = require('./trainerPrompt');

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
