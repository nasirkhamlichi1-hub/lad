'use strict';

// ─────────────────────────────────────────────────────────────────────
// Create / update an account interactively or from CLI flags
// ─────────────────────────────────────────────────────────────────────
// Usage:
//   node scripts/create-account.js \
//     --role lawyer --email y.mansouri@galadari.ae --password 'TempPass123' \
//     --first "Yousef" --last "Al Mansouri" --firm-id F001
//
//   node scripts/create-account.js \
//     --role lad_admin --email admin@legal.dubai.gov.ae --password 'TempPass123' \
//     --first "Aisha" --last "Al Falasi"
//
//   node scripts/create-account.js --seed-demo
//     ↑ creates one of every role with predictable demo credentials
//
// Recognised roles:
//   lawyer
//   lad_admin           (back-office: LAD Admin portal)
//   lad_intelligence    (back-office: LAD Staff intelligence dashboard)
//   firm_compliance_officer
//   provider_admin
//
// Safe to re-run: existing accounts have their password reset.
// Never commits passwords — always re-prompts or takes them on the CLI.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db');

// ─── Tiny arg parser ────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// ─── Demo-seed shortcut ────────────────────────────────────────────────
if (args['seed-demo']) {
  const accounts = [
    { role: 'lawyer',                  email: 'lawyer@demo.lad.dubai.gov.ae',   first: 'Yousef',  last: 'Al Mansouri',  pass: 'DemoLawyer!2026',  id: 'L-00001', firm: null,    credits: 25 },
    { role: 'firm_compliance_officer', email: 'firmco@demo.lad.dubai.gov.ae',   first: 'Layla',   last: 'Al Hashimi',   pass: 'DemoFirm!2026',    id: null,      firm: 'F001' },
    { role: 'lad_intelligence',        email: 'staff@demo.lad.dubai.gov.ae',    first: 'Sara',    last: 'Hashimi',      pass: 'DemoStaff!2026',   id: null,      firm: null },
    { role: 'lad_admin',               email: 'admin@demo.lad.dubai.gov.ae',    first: 'Aisha',   last: 'Al Falasi',    pass: 'DemoAdmin!2026',   id: null,      firm: null },
  ];
  for (const a of accounts) {
    createAccount(a);
  }
  console.log('');
  console.log('Demo accounts ready:');
  console.log('  Lawyer       lawyer@demo.lad.dubai.gov.ae       DemoLawyer!2026');
  console.log('  Firm CO      firmco@demo.lad.dubai.gov.ae       DemoFirm!2026');
  console.log('  LAD Staff    staff@demo.lad.dubai.gov.ae        DemoStaff!2026');
  console.log('  LAD Admin    admin@demo.lad.dubai.gov.ae        DemoAdmin!2026');
  console.log('');
  console.log('CHANGE THESE PASSWORDS BEFORE SHOWING ANYONE OUTSIDE THE TEAM.');
  process.exit(0);
}

// ─── Single-account creation from CLI flags ────────────────────────────
const required = ['role', 'email', 'password', 'first', 'last'];
const missing = required.filter(k => !args[k]);
if (missing.length) {
  console.error('Missing required flags: ' + missing.map(k => '--' + k).join(', '));
  console.error('Run with --help for usage.');
  process.exit(1);
}

createAccount({
  role:    args.role,
  email:   args.email,
  pass:    args.password,
  first:   args.first,
  last:    args.last,
  id:      args.id || null,
  firm:    args['firm-id'] || null,
  credits: args.credits ? parseInt(args.credits, 10) : 0,
});

// ─── Core ──────────────────────────────────────────────────────────────
function createAccount({ role, email, pass, first, last, id, firm, credits }) {
  if (!pass || pass.length < 8) {
    console.error(`✗ ${email}: password must be at least 8 characters`);
    process.exit(1);
  }
  const hash = bcrypt.hashSync(pass, 12);

  if (role === 'lawyer') {
    const lawyerId = id || ('L-' + crypto.randomBytes(4).toString('hex').toUpperCase());
    const exists = db.prepare('SELECT id FROM lawyers WHERE LOWER(email) = LOWER(?)').get(email);
    if (exists) {
      db.prepare(`UPDATE lawyers SET password_hash = ?, first_name = ?, last_name = ?,
                                     firm_id = COALESCE(?, firm_id),
                                     credit_balance = COALESCE(?, credit_balance),
                                     status = 'active'
                                 WHERE id = ?`)
        .run(hash, first, last, firm, credits, exists.id);
      console.log(`✓ Updated lawyer: ${email}  (id=${exists.id})`);
    } else {
      db.prepare(`INSERT INTO lawyers (id, email, first_name, last_name, firm_id, credit_balance, status, password_hash)
                  VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`)
        .run(lawyerId, email, first, last, firm, credits || 0, hash);
      console.log(`✓ Created lawyer: ${email}  (id=${lawyerId})`);
    }
  } else {
    // staff table — covers lad_admin / lad_intelligence / firm_compliance_officer / provider_admin
    const staffId = id || ('S-' + crypto.randomBytes(4).toString('hex').toUpperCase());
    const exists = db.prepare('SELECT id FROM staff WHERE LOWER(email) = LOWER(?)').get(email);
    if (exists) {
      db.prepare(`UPDATE staff SET password_hash = ?, first_name = ?, last_name = ?, role = ?,
                                   firm_id = COALESCE(?, firm_id), status = 'active'
                               WHERE id = ?`)
        .run(hash, first, last, role, firm, exists.id);
      console.log(`✓ Updated staff: ${email}  (id=${exists.id}, role=${role})`);
    } else {
      db.prepare(`INSERT INTO staff (id, email, first_name, last_name, role, firm_id, status, password_hash)
                  VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`)
        .run(staffId, email, first, last, role, firm, hash);
      console.log(`✓ Created staff: ${email}  (id=${staffId}, role=${role})`);
    }
  }
}
