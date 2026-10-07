'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Seed: LAD Module 4 — إخلاء المستأجر من المأجور ومقترحات معالجة الأسباب
//       المؤثرة على حقوق الجهات الحكومية في دعاوى المنازعات الإيجارية
//       (Eviction, and measures that protect government landlords' rights)
// ─────────────────────────────────────────────────────────────────────────
// Loads the M4 programme into the AI Trainer as linked lessons
// (course_id = 'lad-m4-eviction-protection'). Mirrors the Rise build spec in
// courses/lad-m4/LAD-M4-rise-build-spec.md.
//
// The source document carries its own facilitation notes (مراجعة → content →
// تمارين → ملخص). They are written into the trainer's lessons below: open with
// the objective and the learner's experience, close with exercises, a summary
// and the learner's questions.
//
//   node scripts/seed-trainer-lad-m4.js
//
// Idempotent: lessons have stable ids, so re-running updates them in place.
//
// ⚠️  ACCURACY: Article 19 is truncated in the source and only its first
// clause is used. The training objective is derived (the source asks the
// trainer to set it). Confirm both, and the article text, before live CLPD.

require('dotenv').config();
const trainerStore = require('../src/services/trainerStore');

const COURSE = 'lad-m4-eviction-protection';

const BRIEF = {
  persona: 'mentor',
  expertise_level: 'practising',
  depth: 'working',
  turn_length: 'short',
  check_frequency: 'few_points',
  question_style: 'scenario',
  on_wrong_answer: 'hint',
  strictness: 'standard',
  pass_criteria: 'apply',
  language: 'arabic',
  house_rules: [
    'Speak Modern Standard Arabic in a clear professional register suited to government lease managers and LAD legal staff.',
    'Follow the module\'s facilitation flow: review (objective, the learner\'s experience, overview, key points, learning outcomes) → content → exercises → summary and the learner\'s questions.',
    'Use the learner\'s own experience: ask what happens in their entity today and compare it with the eleven recommendations.',
    'Teach only from the lesson. Do not invent deadlines, notice methods or procedures.',
    'Keep two tools distinct: email and text messages are for urging payment and proving refusal; the Article 25 eviction notice goes by notary public or registered post.',
  ].join('\n'),
};

const DISCLAIMER =
  'Teaching note: present the article text as the training summary used by LAD. Remind the learner once, ' +
  'near the end, that the authoritative source is the current consolidated text of the law.';

const LESSONS = [
  // ── 1. Review ─────────────────────────────────────────────────────────
  {
    id: 'lsn_m4_01_review',
    title: 'المحور الرابع — 1. مراجعة: الهدف وخبرتك',
    summary: 'Set the objective, find out what the learner already knows, give the overview and the learning outcomes.',
    duration_min: 5,
    cpd_points: 0,
    objectives: [
      'State the module objective: identify the legal ground for eviction and apply the preventive and escalation measures that protect a government landlord',
      'Describe the learner\'s own experience of following up defaulting leases',
      'Outline the module: eviction grounds; prevention before signing; monitoring during the lease; escalation on default',
    ],
    body: [
      'This lesson is the module\'s review step. Do the five things the source asks for, in order.',
      'One — set the main training objective: by the end, the learner can identify the legal ground for evicting a tenant and apply the preventive and escalation measures that protect the rights of a government landlord before and during a dispute.',
      'Two — ask about the learner\'s knowledge and experience: have they handled defaulting tenants? Who in their entity follows up leases? When does a file reach the Legal Affairs Department today? Listen, and keep their answers to refer back to.',
      'Three — give the overview: first the grounds on which a landlord may seek eviction (Articles 19, 25 and 31); then eleven recommendations to deal with the causes that harm government entities\' rights in rental disputes — before signing, while the lease runs, and when the tenant defaults.',
      'Four — highlight the key point: most losses start months before court — an insolvent tenant, an expired licence, a dead email address, a defaulting lease renewing automatically.',
      'Five — confirm the learning outcomes with the learner and ask which one matters most in their work.',
    ].join('\n\n'),
  },

  // ── 2. Eviction grounds ───────────────────────────────────────────────
  {
    id: 'lsn_m4_02_grounds',
    title: 'المحور الرابع — 2. أولاً: أسباب طلب الإخلاء',
    summary: 'Art. 19 duty to pay on time; Art. 25(1) and 25(2) exhaustive grounds and their notices; Art. 31 rent continues during the claim.',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'State Article 19: the tenant must pay the rent on its due dates',
      'Apply Art. 25(1): the nine exhaustive grounds before expiry, the 30-day notice for non-payment and for breach of obligation, notice by notary or registered post',
      'Apply Art. 25(2): the four exhaustive grounds at expiry and the 12-month notice by notary or registered post',
      'Apply Article 31: rent remains due while the eviction claim is heard, decided and executed',
    ],
    body: [
      'Article 19 (as quoted in the source): the tenant must pay the rent on its due dates. Paying on time is a core obligation; but breach alone does not allow eviction — only the exhaustive cases in Article 25, with the correct notice.',
      'Article 25(1) — eviction before the end of the term, exclusively where: (a) the tenant does not pay the rent or any part within 30 days of the landlord\'s notice to pay, unless otherwise agreed; (b) the tenant sub-lets all or part without the landlord\'s written consent — eviction covers the sub-tenant, who keeps a compensation claim against the tenant; (c) unlawful use, or use against public order or morals; (d) commercial premises left unoccupied without lawful reason for 30 consecutive or 90 intermittent days in a year, unless otherwise agreed; (e) an alteration affecting safety that cannot be reversed, or damage by deliberate act, gross negligence, or allowing others to cause it; (f) use for another purpose, or against planning, building and land-use rules; (g) the property is about to collapse, proved by a Dubai Municipality technical report; (h) failure to observe any legal obligation or lease term within 30 days of notice to perform it; (i) urban-development demolition and rebuilding decided by the competent authorities. Notice under paragraph (1): notary public or registered post.',
      'Article 25(2) — eviction at the end of the lease, exclusively where the owner wants to: (a) demolish and rebuild, or add buildings preventing use, with the necessary permits; (b) restore or comprehensively maintain it where that is impossible with the tenant present, confirmed by a Dubai Municipality report; (c) use it personally or for a first-degree relative, proving he owns no suitable alternative; (d) sell it. The landlord must notify the reasons at least 12 months before the eviction date, by notary public or registered post.',
      'Article 31: filing the eviction claim does not relieve the tenant of rent while the claim is heard, judgment given, and executed.',
      'Check with two scenarios: a payment notice sent by registered post on 1 March — when does the ground arise? (No payment within 30 days.) A tenant stops paying because "the case is pending" — what is the position? (Rent remains due until execution; claim it.)',
    ].join('\n\n'),
  },

  // ── 3. Prevention before signing ──────────────────────────────────────
  {
    id: 'lsn_m4_03_prevention',
    title: 'المحور الرابع — 3. ثانيًا (أ): الوقاية قبل إبرام العقد',
    summary: 'Recommendations 1, 6 and 7: tenant solvency, ongoing licence validity, up-to-date contact details.',
    duration_min: 6,
    cpd_points: 1,
    objectives: [
      'Apply recommendation 1: verify the tenant\'s financial solvency before the lease is signed',
      'Apply recommendation 6: oblige a legal-person tenant to provide periodic proof that its trade/professional licence remains valid',
      'Apply recommendation 7: oblige a legal-person tenant to provide updated contact details, above all email and mobile',
      'Explain why these matter later: the licence proves the representative\'s authority, and current contacts make notice and service possible',
    ],
    body: [
      'Introduce the eleven recommendations to address the causes that harm government entities\' rights in rental disputes. Start with what must happen before signing.',
      'Recommendation 1: verify the tenant\'s financial solvency to confirm it can pay the rent before the contract is concluded.',
      'Recommendation 6: create a mechanism obliging a legal person to provide the landlord, periodically, with proof that its trade or professional licence remains valid. Recommendation 7: a mechanism obliging it to provide updated contact details, most importantly email and mobile. Suggest that the natural place for both obligations is the lease itself, from day one.',
      'Link back to eviction: a valid licence proves who represents the tenant; current email and mobile are what make written action and notice workable. A tenant with an expired licence and a dead inbox means a slower, weaker file.',
      'Ask the learner whether their entity does each of these today, and what stops it if not.',
    ].join('\n\n'),
  },

  // ── 4. Monitoring and escalation ──────────────────────────────────────
  {
    id: 'lsn_m4_04_monitoring',
    title: 'المحور الرابع — 4. ثانيًا (ب و ج): المتابعة والتصعيد',
    summary: 'Recommendations 2–5 (monitoring during the lease) and 8–11 (written action, email, proving abandonment, referral to LAD).',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'Apply the monitoring measures: close periodic follow-up (2), periodic inspection for presence and continued activity (3), a full review of leases over two years old (4), a warning indicator before renewing defaulting leases (5)',
      'Apply the escalation measures: written action (registered post, email, text) within a reasonable time of proven default (8); email to urge settlement and to prove refusal (9); proving abandonment or cessation at 30 consecutive / 90 intermittent days (10)',
      'Know when to notify the Legal Affairs Department: continued non-payment, failure to meet the payment deadline the tenant asked for, or no response to the written notice (11)',
      'Distinguish the tools used to urge and prove from the formal Art. 25 notice by notary or registered post',
    ],
    body: [
      'Monitoring while the lease runs. Recommendation 2: close, periodic follow-up of current leases. Recommendation 3: periodic inspection of the premises to confirm the tenant is still there (residential and commercial) and the business is still operating (commercial). Recommendation 4: a mechanism for a full review of leases signed more than two years ago, to see how far the tenant has met its dues. Recommendation 5: a mechanism giving a warning indicator against continuing to renew leases where the tenant has not paid rent and ancillaries on time.',
      'Link recommendation 5 to the law the learner already knows: silence renews the lease. The indicator is what stops a defaulting lease from renewing without a deliberate decision.',
      'Escalation when the tenant defaults. Recommendation 8: take written action — registered post, email, text message — within a reasonable time after the tenant\'s failure to pay is established. Recommendation 9: email the tenant to urge performance and settlement of the debt, and to prove the fact of refusal. Recommendation 10: prove that the tenant has left the premises or stopped trading once it reaches 30 consecutive or 90 intermittent days. Recommendation 11: notify the Legal Affairs Department when the tenant keeps refusing to pay, does not meet the deadline it asked for, or does not respond to the written notice, so the necessary legal action can be taken.',
      'Make the distinction explicit and check it: email and texts are for urging and for evidence; the eviction notice under Article 25 goes by notary public or registered post.',
      'Check with a scenario: the tenant asked for two weeks to pay, missed it, and has not answered emails — next step? (Notify LAD, recommendation 11.) And: an inspection finds a shop closed for weeks — why does it matter legally? (Abandonment is a ground before expiry; start proving it now.)',
    ].join('\n\n'),
  },

  // ── 5. Exercises and summary ──────────────────────────────────────────
  {
    id: 'lsn_m4_05_exercises',
    title: 'المحور الرابع — 5. تمارين وملخص',
    summary: 'Three cases worked aloud, a summary of the eleven recommendations by stage, and the learner\'s questions.',
    duration_min: 8,
    cpd_points: 1,
    objectives: [
      'Diagnose which recommendations would have prevented the loss in a given case',
      'Count consecutive and intermittent days correctly when assessing abandonment',
      'Summarise the eleven recommendations by stage: before signing, during the lease, on default',
    ],
    body: [
      'This lesson is the source\'s exercises and summary. Facilitate: put each case, observe the learner\'s reasoning, and ask follow-up questions rather than lecturing.',
      'Case 1: a government residential lease renewed automatically three times; the tenant was late every year and nobody noticed until a full year\'s rent was owed. Which recommendations would have prevented it? (4 — review leases over two years old; 5 — warning indicator before renewal; also 2 — close follow-up.)',
      'Case 2: a company tenant ignores emails, and it emerges its licence expired six months ago. What is the lesson? (6 and 7 — oblige periodic proof of licence validity and updated contacts; and now move to written action and referral, 8 and 11.)',
      'Case 3: a shop in a government mall closed 25 days, opened 2, closed 20 more. What now? (Document each closure with dates. No period has reached 30 consecutive days and the total, 45, is below 90 intermittent; keep monitoring the annual total and prove it — recommendation 10.)',
      'Summary: before signing — solvency, licence validity, contacts (1, 6, 7). During the lease — follow-up, inspection, two-year review, renewal warning (2, 3, 4, 5). On default — written action, email to urge and prove, prove abandonment, notify LAD (8, 9, 10, 11). Eviction itself rests only on the exhaustive Article 25 grounds with the correct notice.',
      'Ask the learner to pick one recommendation their entity does not apply today and say who would own it and the first step. Then invite and answer their questions.',
    ].join('\n\n'),
  },

  // ── 6. Assessment ─────────────────────────────────────────────────────
  {
    id: 'lsn_m4_06_assessment',
    title: 'المحور الرابع — 6. التقييم النهائي',
    summary: 'Eight spoken questions with feedback. Pass mark 80% (seven of eight).',
    duration_min: 8,
    cpd_points: 1,
    objectives: [
      'Apply the module across eviction grounds and the protective recommendations',
      'Achieve the 80% pass mark (seven correct out of eight)',
    ],
    body: [
      'Run a spoken assessment in Arabic, one question at a time; confirm the answer with a one-line reason. Seven or more out of eight is a pass.',
      'Q1. When does the non-payment ground arise? No payment within 30 days of the notice to pay (Art. 25(1)(a)).',
      'Q2. How is an Article 25 eviction notice sent? Notary public or registered post.',
      'Q3. Notice period for eviction at expiry because the owner wants to sell? At least 12 months.',
      'Q4. Does an eviction claim suspend the rent? No, it is due until judgment is executed (Art. 31).',
      'Q5. Name one measure taken before signing. Solvency check; or periodic licence-validity proof; or updated contacts.',
      'Q6. What two purposes does emailing a defaulting tenant serve? Urging settlement and proving refusal.',
      'Q7. When is the Legal Affairs Department notified? Continued refusal to pay, missing the deadline the tenant asked for, or no response to the written notice.',
      'Q8. What stops defaulting leases renewing unnoticed? A warning indicator before renewal (recommendation 5).',
      'Give the score, pass or fail against 80%, and the point to revisit.',
      DISCLAIMER,
    ].join('\n\n'),
  },
];

function main() {
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

main();
