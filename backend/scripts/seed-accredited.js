'use strict';

// Loads accredited courses (seed-data/accredited-courses.json) into the courses
// table with their private flag + owning firm. Idempotent (INSERT OR REPLACE on
// stable acc-* ids). Private courses are only ever returned to their owning firm
// or LAD admins by the courses API. Also called lazily if not yet present.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'seed-data', 'accredited-courses.json');
const MIGRATION = path.join(__dirname, '..', 'migrations', '024-accredited-private.sql');

// Add the private/owner columns if they don't exist yet (ALTER errors are fine).
function ensureColumns(db) {
  for (const sql of [
    'ALTER TABLE courses ADD COLUMN private INTEGER DEFAULT 0',
    'ALTER TABLE courses ADD COLUMN owner_firm_id TEXT',
    'ALTER TABLE courses ADD COLUMN accredited_provider TEXT',
  ]) { try { db.exec(sql); } catch (_) {} }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_courses_private ON courses (private)'); } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_courses_owner_firm ON courses (owner_firm_id)'); } catch (_) {}
}

const BG = [
  'linear-gradient(135deg,#1c2b4a,#0a1428)', 'linear-gradient(135deg,#243b2a,#0e1f14)',
  'linear-gradient(135deg,#3a2440,#1a0f24)', 'linear-gradient(135deg,#3a3320,#1f1a0c)',
  'linear-gradient(135deg,#203a3a,#0c1f1f)',
];
function bgFor(id) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return BG[h % BG.length]; }

function loadAccredited(db) {
  if (!fs.existsSync(SRC)) return null;
  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  ensureColumns(db);

  const ins = db.prepare(`INSERT INTO courses
      (id, title, category, type, format, pts, credits, provider_id, location, description, language, active, bg, icon, private, owner_firm_id, accredited_provider, updated_at)
      VALUES (@id, @title, @category, 'accredited', @format, @pts, @credits, NULL, @location, @description, 'English', 1, @bg, '', @private, @owner_firm_id, @accredited_provider, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        title=excluded.title, type='accredited', pts=excluded.pts, private=excluded.private,
        owner_firm_id=excluded.owner_firm_id, accredited_provider=excluded.accredited_provider,
        category=excluded.category, active=1, updated_at=CURRENT_TIMESTAMP`);

  const tx = db.transaction(() => {
    for (const c of data.courses) {
      ins.run({
        id: c.id, title: c.title, category: 'Accredited',
        format: c.private ? 'firm-private' : 'accredited',
        pts: Number(c.points) || 2, credits: 5,
        location: c.owner_firm_name || c.provider || 'Accredited provider',
        description: `${c.title} — accredited CLPD course by ${c.provider}.`,
        bg: bgFor(c.id),
        private: c.private ? 1 : 0,
        owner_firm_id: c.owner_firm_id || null,
        accredited_provider: c.provider || null,
      });
    }
  });
  tx();
  const priv = data.courses.filter((c) => c.private).length;
  return { total: data.courses.length, private: priv, public: data.courses.length - priv };
}

module.exports = { loadAccredited, ensureColumns };

if (require.main === module) {
  const db = require('../src/db');
  if (!fs.existsSync(SRC)) {
    console.error(`✗ ${SRC} not found. Run: node scripts/build-accredited.js <2025.xlsx> <Q1-2026.xlsx>`);
    process.exit(1);
  }
  const r = loadAccredited(db);
  console.log(`✓ Accredited courses loaded: ${r.total} (${r.public} public, ${r.private} private).`);
}
