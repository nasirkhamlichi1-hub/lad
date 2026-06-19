'use strict';

// ─────────────────────────────────────────────────────────────────────
// dedupe-firms.js — consolidate duplicate firm records.
//
// The firm roster was built by slugifying firm names from the lawyer import,
// so name variants ("Clyde & Co LLP" vs "Clyde And Co Llp") produced separate
// firm rows with the lawyers split between them — and a compliance officer
// attached to only one fragment sees a partial cohort.
//
// This merges firms whose names are identical after CONSERVATIVE normalisation
// (normalise &/and + punctuation, strip only entity-type suffixes like LLP/LLC
// /Ltd). Descriptive words are kept, so genuinely different firms are NOT
// merged (e.g. "… & Company Limited" stays apart from "… Advocates & Legal
// Consultants", and personal-name firms stay separate).
//
// All references are repointed to the canonical firm (the one with the most
// lawyers), then the duplicates are deleted. Idempotent: once deduped, re-runs
// are a no-op. Safe to run on every boot.
// ─────────────────────────────────────────────────────────────────────

const db = require('../src/db');

function norm(name) {
  let s = String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ');
  // strip only legal-entity-type suffixes — never descriptive words
  s = s.replace(/\b(llp|llc|ltd|limited|plc|pllc|fze|fzc|fz|incorporated|inc)\b/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function tableExists(t) {
  try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t); } catch (_) { return false; }
}
function colExists(t, c) {
  try { return db.prepare('PRAGMA table_info(' + t + ')').all().some((x) => x.name === c); } catch (_) { return false; }
}

function lawyerCount(firmId) {
  try { return db.prepare('SELECT COUNT(*) n FROM lawyers WHERE firm_id = ?').get(firmId).n; } catch (_) { return 0; }
}

function dedupe() {
  if (!tableExists('firms')) { console.log('[dedupe-firms] no firms table — skipping'); return { merged: 0, removed: 0 }; }
  const firms = db.prepare('SELECT id, name FROM firms').all();

  // Group by normalised name.
  const groups = new Map();
  for (const f of firms) {
    const key = norm(f.name);
    if (!key) continue;                       // never group nameless rows together
    (groups.get(key) || groups.set(key, []).get(key)).push(f);
  }

  let mergedGroups = 0, removed = 0;
  const repoint = db.transaction((fromId, toId) => {
    db.prepare('UPDATE lawyers SET firm_id = ? WHERE firm_id = ?').run(toId, fromId);
    db.prepare('UPDATE staff SET firm_id = ? WHERE firm_id = ?').run(toId, fromId);
    if (colExists('courses', 'owner_firm_id')) db.prepare('UPDATE courses SET owner_firm_id = ? WHERE owner_firm_id = ?').run(toId, fromId);
    if (tableExists('firm_credit_transactions')) db.prepare('UPDATE firm_credit_transactions SET firm_id = ? WHERE firm_id = ?').run(toId, fromId);
    if (tableExists('conversations')) {
      db.prepare('UPDATE conversations SET firm_id = ? WHERE firm_id = ?').run(toId, fromId);
      db.prepare("UPDATE conversations SET requester_id = ? WHERE requester_type = 'firm' AND requester_id = ?").run(toId, fromId);
    }
    // Fold the duplicate's credit pool into the canonical firm, then drop it.
    if (colExists('firms', 'credit_pool')) {
      db.prepare('UPDATE firms SET credit_pool = COALESCE(credit_pool,0) + (SELECT COALESCE(credit_pool,0) FROM firms WHERE id = ?), total_purchased = COALESCE(total_purchased,0) + (SELECT COALESCE(total_purchased,0) FROM firms WHERE id = ?) WHERE id = ?').run(fromId, fromId, toId);
    }
    db.prepare('DELETE FROM firms WHERE id = ?').run(fromId);
  });

  for (const [, group] of groups) {
    if (group.length < 2) continue;
    // Canonical = most lawyers, tie-break by shortest id (cleanest slug).
    group.forEach((g) => { g._n = lawyerCount(g.id); });
    group.sort((a, b) => (b._n - a._n) || (a.id.length - b.id.length));
    const canonical = group[0];
    const dupes = group.slice(1);
    console.log(`[dedupe-firms] "${canonical.name}" (${canonical.id}, ${canonical._n} lawyers) ⇐ ${dupes.map((d) => `${d.id}(${d._n})`).join(', ')}`);
    for (const d of dupes) { repoint(d.id, canonical.id); removed++; }
    mergedGroups++;
  }

  console.log(`[dedupe-firms] done — ${mergedGroups} firm(s) consolidated, ${removed} duplicate record(s) removed.`);
  return { merged: mergedGroups, removed };
}

if (require.main === module) {
  try { dedupe(); } catch (e) { console.error('[dedupe-firms] failed:', e.message); process.exitCode = 1; }
}

module.exports = { dedupe, norm };
