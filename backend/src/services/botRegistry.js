'use strict';

// The bot registry — every avatar learning bot on the platform.
// ---------------------------------------------------------------------
// A "bot" is one AI teacher: a photoreal Anam face + voice, a persona, and a
// teaching charter. Everything else (the lessons, the brain, the progress
// tracking, the CPD award) is shared machinery it plugs into.
//
// Adding a bot is a CONFIG action, not a code change:
//
//   1. Drop a JSON file in backend/bots/  (or run `npm run new-bot`)
//   2. Set its avatarId to the Anam avatar you picked
//   3. Restart — it shows up in GET /api/v1/trainer/bots and at
//      /learning-bot.html?bot=<id>
//
// Nothing below is bot-specific. Adding the tenth bot costs the same as the
// second.

const fs = require('fs');
const path = require('path');
const config = require('../config');
const log = require('../logger');

const BOTS_DIR = path.join(__dirname, '..', '..', 'bots');

// Env override key for a bot field, e.g. bot "anum-learning-bot" + "avatarId"
// → BOT_ANUM_LEARNING_BOT_AVATAR_ID. Lets a deploy swap the avatar or voice
// without a commit (and keeps a not-yet-chosen avatar out of git).
function envKey(botId, field) {
  const id = String(botId).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const f = field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return `BOT_${id}_${f}`;
}

function envOverride(botId, field) {
  const v = process.env[envKey(botId, field)];
  return v && String(v).trim() ? String(v).trim() : '';
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

// Normalise one raw definition into the shape the rest of the app relies on.
// Throws on anything structurally wrong so a bad file fails loudly at boot
// rather than halfway through a learner's session.
function normalise(raw, sourceFile) {
  const id = String(raw.id || '').trim();
  if (!ID_RE.test(id)) {
    throw new Error(`${sourceFile}: "id" must be lowercase letters, digits and hyphens (got ${JSON.stringify(raw.id)})`);
  }
  const name = String(raw.name || '').trim();
  if (!name) throw new Error(`${sourceFile}: "name" is required`);

  // avatarId resolution order: env override → file → the platform default.
  // The default means a brand-new bot is testable before its own avatar is
  // chosen; `avatarPending` tells the UI it is wearing a borrowed face.
  const fileAvatar = String(raw.avatarId || '').trim();
  const avatarId = envOverride(id, 'avatarId') || fileAvatar || config.anam.avatarId || '';
  const voiceId = envOverride(id, 'voiceId') || String(raw.voiceId || '').trim();

  return {
    id,
    name,
    tagline: String(raw.tagline || '').trim(),
    description: String(raw.description || '').trim(),
    avatarId,
    voiceId,
    avatarPending: !(envOverride(id, 'avatarId') || fileAvatar),
    persona: String(raw.persona || '').trim(),
    charter: String(raw.charter || 'clpd-trainer').trim(),
    greeting: String(raw.greeting || '').trim(),
    courseId: raw.courseId || null,
    awardsCpd: raw.awardsCpd !== false,
    perception: raw.perception !== false,
    active: raw.active !== false,
    sourceFile,
  };
}

let cache = null;

function load() {
  const bots = new Map();
  if (!fs.existsSync(BOTS_DIR)) {
    log.error('bot_registry_missing_dir', { dir: BOTS_DIR });
    return bots;
  }
  for (const file of fs.readdirSync(BOTS_DIR).filter(f => f.endsWith('.json')).sort()) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(BOTS_DIR, file), 'utf8'));
      const bot = normalise(raw, file);
      if (bots.has(bot.id)) throw new Error(`${file}: duplicate bot id "${bot.id}"`);
      bots.set(bot.id, bot);
    } catch (e) {
      // One broken definition must not take the other bots down with it.
      log.error('bot_registry_load_failed', { file, error: e.message });
    }
  }
  log.info('bot_registry_loaded', { count: bots.size, ids: [...bots.keys()] });
  return bots;
}

function all() {
  if (!cache) cache = load();
  return cache;
}

function reload() {
  cache = null;
  return all();
}

// Public view of a bot — never leaks sourceFile or anything server-only.
function publicView(bot) {
  if (!bot) return null;
  const { sourceFile, persona, charter, ...rest } = bot;
  return rest;
}

function list({ includeInactive = false } = {}) {
  return [...all().values()]
    .filter(b => includeInactive || b.active)
    .map(publicView);
}

function get(id) {
  const bot = all().get(String(id || '').trim());
  return bot && bot.active ? bot : null;
}

// The bot used when a caller names none — keeps every existing endpoint and
// page working exactly as before this registry existed.
function defaultBot() {
  return get(config.trainerBots.defaultId) || [...all().values()].find(b => b.active) || null;
}

// Resolve a caller-supplied id, falling back to the default. Returns null only
// if an id was given and it does not match an active bot, so callers can 404.
function resolve(id) {
  if (!id) return defaultBot();
  return get(id);
}

module.exports = { list, get, resolve, defaultBot, reload, publicView, envKey };
