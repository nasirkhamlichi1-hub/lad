#!/usr/bin/env node
'use strict';

// Scaffold a new avatar learning bot.
// ---------------------------------------------------------------------
// This is the "simple action" that adds a bot. It writes one JSON file into
// backend/bots/ — no code changes, no migration, no new page.
//
//   npm run new-bot -- --id=contract-coach --name="Layla" \
//                      --avatar=42675ef1-2342-45d8-9603-9bd92ed45699
//
// Options:
//   --id        required  lowercase-hyphen id, also the ?bot= value
//   --name      required  the name the avatar answers to
//   --avatar              Anam avatarId (omit to borrow the platform default)
//   --voice               Anam voiceId (omit for the avatar's default voice)
//   --tagline             one line shown under the name
//   --description         a sentence shown on the bot's card
//   --persona             WHO the bot is; prepended to the teaching charter
//   --greeting            a scripted opening line (omit to let the brain open)
//   --course              limit the bot to one course_id
//   --charter             charter key, default 'clpd-trainer'
//   --no-cpd              this bot does not award CPD points
//   --no-perception       this bot does not use the camera
//   --force               overwrite an existing definition

const fs = require('fs');
const path = require('path');

const BOTS_DIR = path.join(__dirname, '..', 'bots');
const ID_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

function parseArgs(argv) {
  const out = { flags: {} };
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(arg);
    if (!m) { out.error = `Unrecognised argument: ${arg}`; return out; }
    out.flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  console.error('  Usage: npm run new-bot -- --id=<id> --name="<Name>" [--avatar=<anam-avatar-id>]');
  console.error('  Run with --help for every option.\n');
  process.exit(1);
}

const HELP = `
  new-bot — scaffold an avatar learning bot

  npm run new-bot -- --id=contract-coach --name="Layla" --avatar=<anam-avatar-id>

    --id            required   lowercase-hyphen id; also the ?bot= value
    --name          required   the name the avatar answers to
    --avatar                   Anam avatarId (omit to borrow the default)
    --voice                    Anam voiceId
    --tagline                  one line under the name
    --description              a sentence for the bot's card
    --persona                  WHO the bot is (prepended to the charter)
    --greeting                 a scripted opening line
    --course                   restrict to one course_id
    --charter                  charter key (default: clpd-trainer)
    --no-cpd                   do not award CPD points
    --no-perception            do not use the camera
    --force                    overwrite an existing definition

  Then restart the API. The bot appears in GET /api/v1/trainer/bots and at
  /learning-bot.html?bot=<id>. No code changes are needed.
`;

function main() {
  const { flags, error } = parseArgs(process.argv.slice(2));
  if (error) fail(error);
  if (flags.help) { console.log(HELP); return; }

  const id = String(flags.id || '').trim();
  const name = String(flags.name || '').trim();

  if (!id) fail('--id is required');
  if (!ID_RE.test(id)) fail(`--id must be lowercase letters, digits and hyphens (got "${id}")`);
  if (!name) fail('--name is required');

  const file = path.join(BOTS_DIR, `${id}.json`);
  if (fs.existsSync(file) && !flags.force) {
    fail(`${path.relative(process.cwd(), file)} already exists — pass --force to overwrite`);
  }

  const bot = {
    id,
    name,
    tagline: String(flags.tagline || '').trim(),
    description: String(flags.description || '').trim(),
    // Empty avatarId means "borrow the platform default" — the bot is testable
    // straight away and the registry flags it as avatarPending in the UI.
    avatarId: String(flags.avatar || '').trim(),
    voiceId: String(flags.voice || '').trim(),
    persona: String(flags.persona || `You are ${name}, a warm and precise learning coach.`).trim(),
    charter: String(flags.charter || 'clpd-trainer').trim(),
    greeting: String(flags.greeting || '').trim(),
    courseId: flags.course ? String(flags.course).trim() : null,
    awardsCpd: !flags['no-cpd'],
    perception: !flags['no-perception'],
    active: true,
  };

  if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bot, null, 2) + '\n');

  console.log(`\n  ✓ Created ${path.relative(process.cwd(), file)}\n`);
  console.log(`    ${bot.name} — ${bot.tagline || 'no tagline'}`);
  if (!bot.avatarId) {
    console.log(`    ⚠ No avatarId yet, so it borrows the platform default face.`);
    console.log(`      Set it in the file, or without committing it:`);
    console.log(`        BOT_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_AVATAR_ID=<anam-avatar-id>`);
  }
  console.log(`\n  Next: restart the API, then open`);
  console.log(`        /learning-bot.html?bot=${id}\n`);
}

main();
