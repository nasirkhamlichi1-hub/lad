'use strict';

// ─────────────────────────────────────────────────────────────────────
// Course meta-tagger — maps a course (title + description + areas) onto the
// controlled skills taxonomy so it slots into the "smart courses" ecosystem.
//
// Tags written to course_topics drive: each lawyer's skill graph, gap-based
// recommendations, the firm capability view and the profession heatmap.
//
//   suggestTags(course)  → { engine, tags:[{topic_id,label,domain,weight,
//                            confidence,why}] }   (does NOT persist)
//
// AiModel is used when configured; a deterministic keyword heuristic is the
// always-available fallback so tagging works even with no AI endpoint.
// ─────────────────────────────────────────────────────────────────────

const db = require('../db');
const aimodel = require('./aimodel');
const log = require('../logger');

// Keyword fingerprints per taxonomy topic for the heuristic fallback.
// (Topic IDs match migrations/012-skills-taxonomy.sql.)
const KEYWORDS = {
  'dr.arb-intl':    ['international arbitration', 'arbitration', 'uncitral', 'icc', 'tribunal', 'arbitral', 'new york convention', 'seat of arbitration'],
  'dr.arb-difc':    ['difc', 'adgm', 'difc-lcia', 'arbitration centre', 'dial', 'dubai arbitration', 'financial centre court'],
  'dr.litigation':  ['litigation', 'court', 'civil procedure', 'cassation', 'judgment', 'pleading', 'first instance', 'appeal'],
  'dr.mediation':   ['mediation', 'mediator', 'adr', 'conciliation', 'amicable settlement', 'negotiated', 'solve'],
  'dr.enforce':     ['enforcement', 'recognition', 'execution of award', 'set aside', 'annulment', 'enforce a judgment'],
  'corp.ma':        ['merger', 'acquisition', 'm&a', 'due diligence', 'share purchase', 'takeover', 'spa'],
  'corp.governance':['corporate governance', 'board', 'directors duties', 'shareholder', 'esg governance', 'compliance committee'],
  'corp.contracts': ['contract', 'commercial agreement', 'drafting clauses', 'exclusion clause', 'indemnity', 'warranties', 'boilerplate'],
  'corp.companies': ['company law', 'incorporation', 'company formation', 'free zone company', 'llc', 'memorandum', 'commercial companies law'],
  'corp.insolvency':['insolvency', 'bankruptcy', 'restructuring', 'liquidation', 'creditor', 'winding up'],
  'fin.banking':    ['banking', 'finance', 'lending', 'loan', 'security interest', 'islamic finance', 'syndicated'],
  'fin.tax':        ['tax', 'vat', 'corporate tax', 'transfer pricing', 'fta', 'excise', 'taxation'],
  'fin.crypto':     ['crypto', 'virtual asset', 'carf', 'vara', 'digital asset', 'blockchain', 'token'],
  'fin.capital':    ['capital markets', 'securities', 'ipo', 'listing', 'bonds', 'sukuk', 'prospectus'],
  'reg.aml':        ['money laundering', 'aml', 'cft', 'goaml', 'suspicious transaction', 'kyc', 'beneficial owner', 'fatf'],
  'reg.sanctions':  ['sanctions', 'targeted financial sanctions', 'tfs', 'ofac', 'embargo', 'screening', 'designated'],
  'reg.data':       ['data protection', 'privacy', 'pdpl', 'gdpr', 'personal data', 'data breach', 'consent'],
  'reg.competition':['competition', 'antitrust', 'merger control', 'dominance', 'cartel', 'abuse of dominant'],
  'reg.esg':        ['esg', 'sustainability', 'climate', 'net zero', 'green', 'sustainable finance'],
  'rec.realestate': ['real estate', 'property law', 'lease', 'tenancy', 'rera', 'jointly owned', 'off-plan', 'land'],
  'rec.construction':['construction', 'fidic', 'contractor', 'engineering', 'infrastructure', 'project', 'defects liability'],
  'rec.property-disp':['property dispute', 'owners association', 'service charge', 'eviction', 'rdc', 'rental dispute'],
  'emp.employment': ['employment', 'labour law', 'gratuity', 'wps', 'termination', 'workplace', 'employee', 'mohre'],
  'emp.immigration':['immigration', 'visa', 'golden visa', 'residency', 'work permit', 'sponsorship', 'emirates id'],
  'tech.ai-gov':    ['ai governance', 'ai risk', 'artificial intelligence', 'ai regulation', 'ai compliance', 'algorithmic', 'ai legal risk'],
  'tech.ai-use':    ['responsible ai', 'ai tools', 'generative ai', 'copilot', 'ai in legal practice', 'prompt', 'using ai'],
  'tech.legaltech': ['legal technology', 'legaltech', 'automation', 'e-discovery', 'legal innovation', 'document automation'],
  'tech.ethics':    ['ethics', 'professional conduct', 'code of conduct', 'integrity', 'conflict of interest', 'professional responsibility', 'discipline'],
  'tech.ip':        ['intellectual property', 'trademark', 'patent', 'copyright', 'ip', 'brand protection', 'trade secret'],
  'skill.drafting': ['legal drafting', 'drafting', 'writing', 'legal writing', 'clause drafting', 'memo'],
  'skill.advocacy': ['advocacy', 'negotiation', 'oral advocacy', 'persuasion', 'cross-examination', 'submissions'],
  'skill.research': ['legal research', 'research', 'analysis', 'case law', 'precedent', 'legal analysis'],
};

function taxonomyTopics() {
  try {
    return db.prepare("SELECT id, label, domain FROM taxonomies WHERE active=1 AND level=2 ORDER BY display_order").all();
  } catch (_) { return []; }
}

function domainLabel(domain) {
  try {
    const r = db.prepare("SELECT label FROM taxonomies WHERE id=? AND level=1").get(domain);
    return r ? r.label : domain;
  } catch (_) { return domain; }
}

function courseText(course) {
  return [course.title, course.description || course.desc, course.areas || course.practice_areas || '',
    course.category, course.matchReason].filter(Boolean).join(' \n ').toLowerCase();
}

// Whole-word/phrase match so short keywords (e.g. "ip", "vat") don't match
// inside unrelated words ("multiple", "innovative").
function hasKeyword(haystack, kw) {
  const re = new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
  return re.test(haystack);
}

// ── Heuristic: keyword scoring against each topic ──
function heuristicTags(course, limit = 5) {
  const title = (course.title || '').toLowerCase();
  const text = courseText(course);
  const scored = [];
  for (const t of taxonomyTopics()) {
    const kws = KEYWORDS[t.id] || [t.label.toLowerCase()];
    let score = 0;
    for (const kw of kws) {
      if (hasKeyword(title, kw)) score += 3;      // title hit weighs heavily
      else if (hasKeyword(text, kw)) score += 1;
    }
    // light label match as a backstop
    if (!score && hasKeyword(text, t.label.toLowerCase())) score += 1;
    if (score > 0) scored.push({ topic: t, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  const max = top.length ? top[0].score : 1;
  return top.map((s, i) => ({
    topic_id: s.topic.id,
    label: s.topic.label,
    domain: s.topic.domain,
    domain_label: domainLabel(s.topic.domain),
    weight: Math.max(0.2, Math.min(1, s.score / (max + 1) * (i === 0 ? 1 : 0.9))),
    confidence: Math.min(0.95, 0.45 + s.score / (max * 2 || 1) * 0.5),
    why: 'Keyword match in course content',
  }));
}

// ── AiModel: ask the model to map onto the taxonomy ──
async function aimodelTags(course) {
  const topics = taxonomyTopics();
  if (!topics.length) return null;
  const list = topics.map(t => `${t.id} :: ${t.label} (${t.domain})`).join('\n');
  const system = 'You are a legal CLPD curriculum specialist tagging a course against a controlled skills taxonomy for Dubai lawyers. Choose ONLY topic IDs from the provided taxonomy. Return ONLY a JSON array (3-6 items) of {"topic_id": string, "weight": number 0..1 (how central the topic is to the course), "why": short string}. Highest-weight first. Do not invent IDs.';
  const user = `Course title: ${course.title}\nDescription: ${course.description || course.desc || ''}\nPractice areas: ${course.areas || course.practice_areas || ''}\n\nTaxonomy (id :: label (domain)):\n${list}`;
  const text = await aimodel.chat({ system, messages: [{ role: 'user', content: user }], maxTokens: 700, temperature: 0.2 });
  let parsed = null;
  try { const m = text.match(/\[[\s\S]*\]/); parsed = JSON.parse(m ? m[0] : text); } catch (_) {}
  if (!Array.isArray(parsed)) return null;
  const byId = new Map(topics.map(t => [t.id, t]));
  const out = [];
  for (const p of parsed) {
    const t = byId.get(p.topic_id);
    if (!t) continue;
    out.push({
      topic_id: t.id, label: t.label, domain: t.domain, domain_label: domainLabel(t.domain),
      weight: Math.max(0.1, Math.min(1, Number(p.weight) || 0.5)),
      confidence: 0.9, why: (p.why || 'Identified by AiModel').toString().slice(0, 140),
    });
  }
  return out.length ? out : null;
}

async function suggestTags(course) {
  if (aimodel.configured()) {
    try {
      const tags = await aimodelTags(course);
      if (tags && tags.length) return { engine: 'aimodel', tags };
    } catch (e) { log.error('coursetagger_aimodel', { error: e.message }); }
  }
  return { engine: 'heuristic', tags: heuristicTags(course) };
}

module.exports = { suggestTags, heuristicTags, taxonomyTopics };
