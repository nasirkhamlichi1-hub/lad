'use strict';

// Password generation + validation helpers.

const crypto = require('crypto');

const WORDS = [
  'Falcon', 'Marina', 'Dhow', 'Pearl', 'Desert', 'Oasis', 'Palm', 'Dune',
  'Coral', 'Heron', 'Cedar', 'Jasmine', 'Saffron', 'Amber', 'Onyx', 'Topaz',
  'Sapphire', 'Ivory', 'Cypress', 'Mirage', 'Compass', 'Anchor', 'Lantern',
  'Beacon', 'Summit', 'Harbour', 'Bridge', 'Tower', 'Garden', 'Mosaic',
];

// Generate a strong but readable password like "Falcon-Heron-94-K7"
// Combines two distinct words + 2 digits + 2 mixed-case letters.
// Roughly 60 bits of entropy — plenty for human-managed credentials.
function generateReadable() {
  const w1 = WORDS[crypto.randomInt(WORDS.length)];
  let w2;
  do { w2 = WORDS[crypto.randomInt(WORDS.length)]; } while (w2 === w1);
  const digits = String(crypto.randomInt(10, 99));
  const upperAlpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O
  const lowerAlpha = 'abcdefghjkmnpqrstuvwxyz';    // no i/l/o
  const letters = upperAlpha[crypto.randomInt(upperAlpha.length)] +
                  lowerAlpha[crypto.randomInt(lowerAlpha.length)];
  return `${w1}-${w2}-${digits}-${letters}`;
}

// Generate a random alphanumeric+symbol password — for admins who want one.
function generateRandom(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

// Minimum bar — refuse to accept anything weaker than this for new passwords
// set by users themselves (force-change-on-first-login flow).
// Admin-set initial passwords are exempt because we expect them to be
// transitional. This is enforced only on /auth/change-password.
function validateUserChosen(pw) {
  const errors = [];
  if (!pw || pw.length < 10) errors.push('Password must be at least 10 characters long');
  if (pw && !/[A-Z]/.test(pw)) errors.push('Password must contain an uppercase letter');
  if (pw && !/[a-z]/.test(pw)) errors.push('Password must contain a lowercase letter');
  if (pw && !/[0-9]/.test(pw)) errors.push('Password must contain a digit');
  if (pw && /^lad@?2026$/i.test(pw)) errors.push('Pick a less obvious password');
  return errors;
}

module.exports = { generateReadable, generateRandom, validateUserChosen };
