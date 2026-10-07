'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Seed: LAD Module 2 — المستندات الأساسية في معاملات المنازعات الإيجارية
//       (Key documents in rental-dispute cases)
// ─────────────────────────────────────────────────────────────────────────
// Loads the M2 programme into the AI Trainer as linked lessons
// (course_id = 'lad-m2-rental-documents'). Mirrors the Rise build spec in
// courses/lad-m2/LAD-M2-rise-build-spec.md, lesson for lesson, so a learner
// can take the course in Rise or talk it through 1-2-1 with the avatar.
//
//   node scripts/seed-trainer-lad-m2.js
//
// Idempotent: lessons have stable ids, so re-running updates them in place.
//
// ⚠️  ACCURACY: article text is taken from the LAD-M2 source document (Dubai
// Law No. 26 of 2007 as amended by Law No. 33 of 2008). Confirm it against the
// current consolidated text before use in live CLPD.

require('dotenv').config();

const COURSE = 'lad-m2-rental-documents';

const BRIEF = {
  persona: 'practitioner',
  expertise_level: 'practising',
  depth: 'working',
  turn_length: 'short',
  check_frequency: 'few_points',
  question_style: 'mixed',
  on_wrong_answer: 'reteach',
  strictness: 'standard',
  pass_criteria: 'apply',
  language: 'arabic',
  house_rules: [
    'Speak Modern Standard Arabic, in a clear professional register suited to LAD legal staff.',
    'Use the exact Arabic legal terms from the lesson (الطلب، المأجور، بدل الإيجار، ملحقات الأجرة، أجر المثل، الشروط والأحكام العامة).',
    'Teach only from the lesson material. Do not invent article numbers, fees, deadlines or case law.',
    'Keep returning to the module\'s core test for every claim: ما مصدر الالتزام؟ وما الدليل على الواقعة؟',
    'When the learner names a document, ask which claim it supports; when they name a claim, ask which document proves it.',
  ].join('\n'),
};

const DISCLAIMER =
  'Teaching note: present the article text as the training summary used by LAD. Remind the learner once, ' +
  'near the end, that the authoritative source is the current consolidated text of the law.';

const LESSONS = [
  // ── 1. Why documents ──────────────────────────────────────────────────
  {
    id: 'lsn_m2_01_why',
    title: 'المحور الثاني — 1. لماذا المستندات؟ لا قضاء بغير دليل',
    summary: 'The evidential principle behind the module and the two sources of an obligation: law and contract.',
    duration_min: 6,
    cpd_points: 0,
    objectives: [
      'State the principle: no judgment for a claim without evidence that is valid in form and substance and proves the fact that created it',
      'Identify the two usual sources of an obligation in civil and administrative claims: the law and the contract',
      'Explain why relying on a legal text also requires a document proving the entity\'s right to collect (the VAT example)',
    ],
    body: [
      'Open by telling the learner what this module is for: building a rental-dispute file that a court will accept, document by document, before the claim is filed against the tenant.',
      'Teach the governing principle in the source\'s own words: «فلا قضاء في الطلب إيجابًا بغير دليل صحيح شكلًا وموضوعًا يدعمه ويثبت صحة الواقعة المُنشئة له». Supporting documents are the most important evidence in civil claims.',
      'Every obligation the court is asked to enforce must have a source. Most civil and governmental-administrative claims rest on one of two: the law (نص القانون) or the contract (العقد).',
      'Make the subtle point explicit: when the source is the law, citing the article is not enough. The claimant must also produce the document that proves its own right to demand it. Example: to make the tenant pay VAT, the entity must prove it is one of those entitled to collect that statutory obligation — in practice, its registration certificate with the Federal Tax Authority.',
      'Check understanding with a short scenario: a government landlord claims VAT and attaches only the lease and the VAT law. Ask what is missing and why. The answer is proof of the entity\'s registration/entitlement to collect.',
    ].join('\n\n'),
  },

  // ── 2. The claim ──────────────────────────────────────────────────────
  {
    id: 'lsn_m2_02_claim',
    title: 'المحور الثاني — 2. أولاً: الطلب',
    summary: 'Framing the main claims (eviction or vacating date, rent, each ancillary item) and the tenant\'s contact details.',
    duration_min: 8,
    cpd_points: 0,
    objectives: [
      'Frame the main claims: eviction, or the date the tenant left the premises where the claim is for money only',
      'State the rent claimed and its period, stopping at the date the claim is filed — no future rent',
      'Claim each ancillary item of rent separately, for the same period',
      'List the tenant contact details required and explain that each needs a documented source (مرجعية)',
    ],
    body: [
      'Teach the three main claims one at a time.',
      'First — eviction (الإخلاء). If the tenant has already left and the claim is for money only, the file must instead state the date the tenant left the premises (تاريخ ترك المستأجر للمأجور), because that date fixes the end of the claim period.',
      'Second — the rent due and the claim period. The claim stops at the date the request is filed. Future rent that has not yet fallen due cannot be claimed (لا يجوز المطالبة المستقبلية). Test this with dates: filed 15 March, unpaid since 1 January, lease ends 31 December — the correct period is 1 January to 15 March.',
      'Third — each ancillary item of rent (ملحقات الأجرة) is claimed separately, with its own amount, for the same period. Do not let the learner lump service charges, VAT and penalties into one figure.',
      'Then the tenant\'s contact details and their source (بيانات التواصل مع المستأجر ومرجعيتها): another address inside the UAE other than the leased premises; landline; mobile; email; fax. Stress that mobile and email are the most effective, and that each detail must be traceable to a document (the lease, the trade licence, prior correspondence). Ask why an address other than the premises matters — because the tenant may have left.',
    ].join('\n\n'),
  },

  // ── 3. The lease — essential data ─────────────────────────────────────
  {
    id: 'lsn_m2_03_lease',
    title: 'المحور الثاني — 3. ثانيًا: عقد الإيجار — البيانات الأساسية',
    summary: 'Article 4, registration with the Dubai Land Department, and the essential data and protective clauses a lease should contain.',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'State what Article 4 requires a lease to contain and that all leases must be registered',
      'Know that registration passed from RERA to the Dubai Land Department (Art. 10, Law No. 4 of 2019)',
      'Check the parties correctly: landlord or its authorised representative; individual tenant\'s ID or agent\'s POA; corporate tenant\'s manager per the valid licence',
      'Describe the premises precisely enough to remove uncertainty, including the DEWA number',
      'Name the protective clauses: effective contacts, inspection on handover, periodic inspections, early termination and handover, tenant maintenance, and avoiding an arbitration clause',
    ],
    body: [
      'Read Article 4 to the learner and have them pick out its elements: the lease must contain a description of the property that removes uncertainty (وصفًا نافيًا للجهالة), the purpose, the term, the rent, how it is paid, and the owner\'s name if the owner is not the landlord. Paragraph 2: all leases of property subject to the law, and any amendments, are registered. The registration function was transferred from the Real Estate Regulatory Agency to the Dubai Land Department (Article 10 of Law No. 4 of 2019).',
      'The parties. Landlord: the owner, or a legal representative under a power of attorney that permits it, or the government entity together with the named representative who signs for it. Tenant: a natural person — their details and ID/passport, or the agent\'s power of attorney giving signing authority; a legal person — the manager who is its legal representative as shown on the valid trade or professional licence. Probe: a company tenant\'s "manager" signed — what proves his authority? The valid licence naming him, plus his ID.',
      'The premises: unit number and location, area (number of rooms if residential), floor, building name/number or annex, Makani number, geographic area (district/community/project) and the DEWA number.',
      'Purpose: residential, commercial, administrative, or practising a profession or craft. Term: say only that it is covered in the main training module — do not teach it here.',
      'Protective clauses the lease should contain: effective contact details and their source (email, mobile, fax, domicile, office); proof the tenant inspected the premises and found them fit for the purpose; the landlord\'s right to periodic inspections throughout the term; the cases of early termination on breach and how the premises are handed back; the tenant\'s obligation to maintain and repair throughout the term; and, as far as possible, no arbitration clause.',
      'Check with an application question: drafting a new lease for a government entity, which of these clauses should be avoided where possible? (Arbitration.)',
    ].join('\n\n'),
  },

  // ── 4. Rent and ancillaries ───────────────────────────────────────────
  {
    id: 'lsn_m2_04_rent',
    title: 'المحور الثاني — 4. بدل الإيجار وملحقاته والغرامات',
    summary: 'Articles 9, 11, 12, 13, 14 and 22; what the lease must state about rent; contractual vs statutory ancillaries; contractual penalties.',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'Apply the default rules: Art. 9 market rent (أجر المثل) when rent is not fixed or not provable; Art. 12 four equal annual instalments in advance when payment dates are not agreed',
      'Explain Art. 11 (facilities included in rent unless otherwise agreed), Arts. 13–14 (amendment on renewal, 90 days\' notice) and Art. 22 (tenant pays fees and taxes unless the lease says otherwise)',
      'State what the lease must fix about rent: amount and currency, for the whole term or per year, and how and when it is paid',
      'Distinguish contractual ancillaries (service charges, insurance, utilities, telephone/internet) from statutory ones (VAT where the landlord is taxable, Innovation and Knowledge dirham fees)',
      'Explain why even statutory charges and all contractual penalties should be written expressly into the lease',
    ],
    body: [
      'Frame this lesson with one observation: many of these articles say "unless otherwise agreed". A clear lease decides the point before the default rule does.',
      'Article 9: the parties must fix the rent in the lease; if they omit it or what they agreed cannot be proved, the rent is the market rent (أجر المثل), which the Committee sets having regard to the Agency\'s rent-increase criteria, the general economic situation in the Emirate, the condition of the property and prevailing rents for similar property in the same area. (Amended by Law No. 33 of 2008, in force 15-2-2009; the old text barred any rent increase for two years from the start of the relationship.)',
      'Article 11: rent includes use of the building\'s facilities — pools, sports courts and gyms, health club, parking — unless otherwise agreed. Article 12: rent is paid on the agreed dates; with no agreement or no proof, it is paid in four equal annual instalments, each in advance. Article 13: for renewal, the parties may amend terms or review the rent up or down before expiry; failing agreement the Committee sets a fair rent using the Article 9 criteria. Article 14: a party wanting to amend under Article 13 must notify the other at least ninety days before expiry, unless otherwise agreed. Article 22: unless the lease says otherwise, the tenant pays all fees and taxes due to government bodies for use of the property, and any fees or taxes on sub-letting.',
      'What the lease itself must fix: the rent and its currency for the whole term or for each year; how and when it is paid (in full before the start, or in instalments by cheques with their due dates); and the ancillaries.',
      'Ancillaries come in two kinds. Contractual: service charges, insurance, water/electricity consumption, telephone, internet. Statutory ("fees"): VAT if the landlord is a taxable company, and the Innovation and Knowledge dirham fees. The source document insists that even the statutory obligations the law already places on the tenant be written into the lease, to prevent any exercise of discretion. Contractual penalties for breach — late rent, returned cheques, failure to operate, change of activity — must also be stated clearly.',
      'Check with two applied questions: (1) no payment dates in the lease and none provable — how is rent due? (Four equal annual instalments in advance, Art. 12.) (2) Have the learner sort a list of items into contractual vs statutory ancillaries.',
    ].join('\n\n'),
  },

  // ── 5. Supporting documents ───────────────────────────────────────────
  {
    id: 'lsn_m2_05_documents',
    title: 'المحور الثاني — 5. ثالثًا إلى تاسعًا: المستندات الداعمة',
    summary: 'Identity documents, general terms and conditions, registration certificate, FTA certificate, returned cheque, utility bills and the Arabic claim statement.',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'Name the tenant identity documents for a natural person and for a legal person',
      'Explain why general terms and conditions referred to in the lease must be filed, and that the version in force when the lease was signed is the one that counts',
      'Match each specific claim to its document: VAT → FTA registration certificate; returned-cheque penalty → cheque copy and bank return memo; separately claimed utilities → utility bills',
      'Know that the tenancy registration certificate is filed and that the financial claim statement is itemised and in Arabic',
    ],
    body: [
      'Third — tenant identity. Natural person: Emirates ID / passport / residence visa / power of attorney. Legal person: the professional or trade licence, which must show the name of the responsible manager who signed the lease, plus his ID/passport.',
      'Fourth — the general terms and conditions, where the lease refers to them. They are an unsigned document relied on as a source of the contractual obligations being claimed, so they must be filed in the case, and it must be the version in force at the time the lease was made where there are several versions or updates. Mention the supporting clauses shown in the source: the tenant\'s acknowledgement in the lease that it accepts the general terms; the precedence clause (basic data, then special terms, then general terms); and the standard-terms definition stating that in a conflict the lease details prevail.',
      'Fifth — the tenancy contract information registration certificate (issued by the Dubai Land Department).',
      'Sixth — the government entity\'s registration certificate with the Federal Tax Authority, when VAT is claimed.',
      'Seventh — a copy of the cheque and the drawee bank\'s memo stating why it was returned, when a returned-cheque penalty is claimed.',
      'Eighth — utility consumption bills, when utilities are claimed separately from service charges.',
      'Ninth — a statement of the financial claim that itemises each element, its amount and its period, in Arabic.',
      'Check with matching: give the learner a claim and ask for its document, then reverse it. Then ask: lease signed in 2022 referring to the general terms, which were updated in 2024 — which version is filed? (2022.)',
    ].join('\n\n'),
  },

  // ── 6. Apply ──────────────────────────────────────────────────────────
  {
    id: 'lsn_m2_06_apply',
    title: 'المحور الثاني — 6. طبّق: جهّز ملف الدعوى',
    summary: 'A worked case: the learner builds the full file for a taxable government landlord against a corporate tenant who left after a returned cheque.',
    duration_min: 8,
    cpd_points: 1,
    objectives: [
      'Frame the claims correctly for a tenant who has already left (vacating date, rent to that date, each ancillary separately)',
      'Assemble every supporting document the case needs and justify each one by the claim it proves',
      'Answer for each claim: what is the source of the obligation, and what proves the fact',
    ],
    body: [
      'Run this as a case the learner works through aloud. Give the facts, then let them build the file step by step; only prompt when they stall.',
      'Facts: a taxable government entity leased a residential villa to a company for one year at AED 135,000, payable by four cheques. The lease refers to the general terms and conditions published on the tenant portal. The second cheque was returned for insufficient funds; the tenant paid neither of the next two instalments and then left the villa. The entity claims the unpaid rent, VAT, the returned-cheque penalty and service charges.',
      'A complete answer covers: (1) claims — the date the tenant left instead of eviction, rent up to that date and never beyond the filing date, then VAT, the cheque penalty and service charges each separately for the same period; (2) contact details — another address in the UAE, mobile and email traceable to the lease or licence; (3) lease check — parties and the manager\'s authority, description, purpose, term, rent and payment method, express VAT and penalty clauses; (4) documents — the lease, its registration certificate, the valid trade licence and manager\'s ID, the general terms in the version in force at signing, the FTA certificate, the cheque copy and bank memo; (5) an itemised claim statement in Arabic.',
      'Then vary the facts to test judgement: (a) the penalty is only in the general terms, not the lease — what must be filed? (The general terms in force at signing, plus the cheque and bank memo.) (b) service charges already include utilities — are utility bills needed? (No; only if utilities are claimed separately.)',
      'Close by asking the learner to name the two questions every claim in the file must answer.',
    ].join('\n\n'),
  },

  // ── 7. Assessment ─────────────────────────────────────────────────────
  {
    id: 'lsn_m2_07_assessment',
    title: 'المحور الثاني — 7. التقييم النهائي',
    summary: 'Eight spoken questions with feedback. Pass mark 80% (seven of eight).',
    duration_min: 8,
    cpd_points: 1,
    objectives: [
      'Apply the module across claims, lease contents, rent rules and supporting documents',
      'Achieve the 80% pass mark (seven correct out of eight)',
    ],
    body: [
      'Run a spoken assessment. Ask the eight questions one at a time in Arabic, let the learner answer in their own words, then confirm the correct answer with a one-line explanation. Keep score; seven or more correct is a pass.',
      'Q1. When does the claim for rent due stop? — At the date the request is filed; future rent cannot be claimed.',
      'Q2. Which body now registers leases? — The Dubai Land Department (Art. 10, Law No. 4 of 2019).',
      'Q3. Name three things Article 4 requires a lease to contain. — Any three of: a description removing uncertainty, purpose, term, rent, how it is paid, owner\'s name if not the landlord.',
      'Q4. If the rent was not fixed or cannot be proved, what is it? — Market rent (أجر المثل) set by the Committee (Art. 9).',
      'Q5. What document supports a VAT claim? — The entity\'s registration certificate with the Federal Tax Authority.',
      'Q6. Which version of the general terms is filed? — The one in force when the lease was signed.',
      'Q7. In what language is the financial claim statement? — Arabic, itemised by element, amount and period.',
      'Q8. When are utility bills attached? — Only when utilities are claimed separately from service charges.',
      'After Q8, give the score, confirm pass or fail against 80%, and name the one or two points to revisit.',
      DISCLAIMER,
    ].join('\n\n'),
  },
];

function main() {
  const trainerStore = require('../src/services/trainerStore');
  console.log(`[seed] loading ${LESSONS.length} lessons for course "${COURSE}"…`);
  for (const L of LESSONS) {
    const saved = trainerStore.upsertLesson(
      { ...L, course_id: COURSE, language: 'Arabic', teaching_brief: BRIEF, active: true },
      'seed-script'
    );
    console.log(`  ✓ ${saved.id}  ${saved.title}  (${saved.duration_min} min, ${saved.cpd_points} CPD, ${saved.objectives.length} key elements)`);
  }
  const totalMin = LESSONS.reduce((s, L) => s + (L.duration_min || 0), 0);
  const totalCpd = LESSONS.reduce((s, L) => s + (L.cpd_points || 0), 0);
  console.log(`\n[seed] done — ${LESSONS.length} lessons, ~${totalMin} min total, ${totalCpd} CPD points.`);
}

if (require.main === module) main();

module.exports = { COURSE, BRIEF, LESSONS };
