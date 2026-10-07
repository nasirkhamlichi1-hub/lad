'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Seed: LAD Module 3 — تنفيذ عقد الإيجار، وأسباب وإجراءات إنهائه أو فسخه
//       (Performing the lease, and the grounds and procedure to end it)
// ─────────────────────────────────────────────────────────────────────────
// Loads the M3 programme into the AI Trainer as linked lessons
// (course_id = 'lad-m3-lease-termination'). Mirrors the Rise build spec in
// courses/lad-m3/LAD-M3-rise-build-spec.md.
//
//   node scripts/seed-trainer-lad-m3.js
//
// Idempotent: lessons have stable ids, so re-running updates them in place.
//
// ⚠️  ACCURACY: the LAD-M3 source gives the article text in full (Law No. 26
// of 2007 as amended by Law No. 33 of 2008; Civil Transactions Law Art. 742)
// but only outlines Sections 1–5. The trainer is told to teach from the
// articles and not to add rules the source does not state. Confirm the text
// against the current consolidated law before live CLPD.

require('dotenv').config();

const COURSE = 'lad-m3-lease-termination';

const BRIEF = {
  persona: 'practitioner',
  expertise_level: 'practising',
  depth: 'working',
  turn_length: 'short',
  check_frequency: 'few_points',
  question_style: 'scenario',
  on_wrong_answer: 'reteach',
  strictness: 'standard',
  pass_criteria: 'cite',
  language: 'arabic',
  house_rules: [
    'Speak Modern Standard Arabic in a clear professional register suited to LAD legal staff.',
    'Teach only from the articles in the lesson. Do not invent deadlines, notice methods, case law or exceptions.',
    'For every termination scenario make the learner answer three things: which ground (and which article), which notice form, and which deadline.',
    'Insist on the word "حصرًا": the Article 25 grounds are exhaustive. A reason outside the list is not a ground.',
    'Where the lesson flags a gap in the law, say it is a gap and present it as a point for discussion, not as settled law.',
  ].join('\n'),
};

const DISCLAIMER =
  'Teaching note: present the article text as the training summary used by LAD. Remind the learner once, ' +
  'near the end, that the authoritative source is the current consolidated text of the law.';

const LESSONS = [
  // ── 1. Introduction & framework ───────────────────────────────────────
  {
    id: 'lsn_m3_01_intro',
    title: 'المحور الثالث — 1. مقدمة: الهدف والتنظيم التشريعي',
    summary: 'The module objective, the study plan, and the two governing laws.',
    duration_min: 6,
    cpd_points: 0,
    objectives: [
      'State the module objective: taking every legal step needed to end the tenancy before a claim is filed',
      'Outline the study plan: performance, the renewal rule, its exceptions, notice form and deadlines, and the common eviction grounds',
      'Name the two governing laws: Federal Law No. 5 of 1985 (Civil Transactions Law) and Dubai Law No. 26 of 2007, as amended by Law No. 33 of 2008 (in force 15-2-2009)',
    ],
    body: [
      'Open by asking the learner briefly what experience they have of ending leases or sending notices to tenants. Use the answer to pitch the rest of the module.',
      'State the objective from the source: by the end, the learner can take all the legal steps needed to end the tenancy relationship before a court claim is filed.',
      'Give the study plan in one breath: how the lease is performed while it runs and what can interrupt it; the main rule of automatic renewal; the exceptions that prevent renewal or change its terms; the form, procedure and deadlines for ending the lease; and the grounds most often relied on in eviction claims.',
      'The framework: the general rule is in Federal Law No. 5 of 1985 issuing the Civil Transactions Law; the special law is Dubai Law No. 26 of 2007 regulating the relationship between landlords and tenants in Dubai, amended by Law No. 33 of 2008 with effect from 15-2-2009.',
    ].join('\n\n'),
  },

  // ── 2. Definition, elements, term ─────────────────────────────────────
  {
    id: 'lsn_m3_02_definition',
    title: 'المحور الثالث — 2. تعريف عقد الإيجار وأركانه ومدته',
    summary: 'Civil Code Art. 742 vs Law 26/2007 Art. 2; Art. 4 contents and registration; Art. 5 default term.',
    duration_min: 6,
    cpd_points: 0,
    objectives: [
      'Compare the two definitions (Art. 742 Civil Transactions Law; Art. 2 Law 26 of 2007) and name the common elements: benefit for a purpose, a fixed term, a known rent',
      'Recall Article 4: required contents and registration (now with the Dubai Land Department)',
      'Apply Article 5: where the term is not fixed or cannot be proved, the lease runs for the rent-payment period',
    ],
    body: [
      'Article 742 of the Civil Transactions Law: «تمليك المؤجر للمستأجر منفعة مقصودة من الشيء المؤجر لمدة معينة لقاء أجر معلوم». Article 2 of Law 26 of 2007: «العقد الذي يلتزم المؤجر بمقتضاه بتمكين المستأجر من الانتفاع بالعقار لغرض معين مدة معينة لقاء بدل معين». Ask the learner to find the common elements: the benefit (and its purpose), the term, and the rent.',
      'Article 4: the lease must contain a description of the property removing uncertainty, its purpose, the term, the rent and how it is paid, and the owner\'s name if not the landlord; all leases and amendments are registered — the registration function passed to the Dubai Land Department (Art. 10, Law No. 4 of 2019).',
      'Article 5: the term must be fixed; if it is not, or the claimed term cannot be proved, the lease is treated as made for the period fixed for paying the rent. Test it: no term stated, rent paid monthly — the lease is for one month; rent paid quarterly — three months.',
    ].join('\n\n'),
  },

  // ── 3. Performance during the term ────────────────────────────────────
  {
    id: 'lsn_m3_03_performance',
    title: 'المحور الثالث — 3. القسم الأول: تنفيذ العقد أثناء سريانه',
    summary: 'Landlord and tenant rights and obligations while the lease runs; rent rules; Art. 31.',
    duration_min: 8,
    cpd_points: 1,
    objectives: [
      'State the landlord\'s obligations: conclude the lease with its required contents, register it, and hand over the property fit for use (Art. 15), with the unfinished-property exception',
      'State the tenant\'s obligations: pay rent on the agreed dates with its ancillaries (Arts. 12, 22), preserve the premises, and respect contract terms on improvements and penalties',
      'Apply the rent rules in Arts. 9, 11, 12 and 22',
      'Apply Article 31: filing an eviction claim does not suspend rent until judgment is executed',
    ],
    body: [
      'The source outlines this section; teach the obligations it names and the articles it quotes, and nothing beyond them.',
      'Landlord: conclude the lease with its required contents and register it (Art. 4); hand the property over in a usable condition that enables the tenant to obtain the contracted benefit (Art. 15). Exception in Art. 15: the parties may agree to lease an unfinished property that the tenant completes and makes fit, and the agreement must say which party bears the completion cost.',
      'Tenant: the right to use the premises and their facilities; the duty to pay rent on the agreed dates together with its ancillaries (fees and taxes) and the exceptions to that; to preserve the premises; and the questions of additions and improvements and of contractual penalties.',
      'Rent rules: Art. 9 — if the rent is not fixed or not provable, it is the market rent set by the Committee. Art. 11 — rent includes use of the building\'s facilities unless otherwise agreed. Art. 12 — rent is paid on the agreed dates, failing which in four equal annual instalments in advance. Art. 22 — unless the lease says otherwise, the tenant pays all government fees and taxes due for use of the property, and any on sub-letting.',
      'Article 31: filing an eviction claim does not relieve the tenant from paying rent for the whole time the claim is heard, judgment is given and it is executed. Check with dates: claim filed in March, judgment executed in September — rent runs to September.',
    ].join('\n\n'),
  },

  // ── 4. The renewal rule ───────────────────────────────────────────────
  {
    id: 'lsn_m3_04_renewal',
    title: 'المحور الثالث — 4. القسم الثاني: القاعدة — التجديد التلقائي',
    summary: 'Article 6: silence plus continued occupation renews the lease for the same term or one year, whichever is shorter, on the same terms.',
    duration_min: 6,
    cpd_points: 1,
    objectives: [
      'State Article 6: if the term ends and the tenant stays without objection from the landlord, the lease renews for the same term or one year, whichever is shorter, on the same terms',
      'Calculate the renewal period for leases shorter and longer than one year',
      'Explain the practical consequence: silence renews, so a landlord who wants a change must act before expiry',
    ],
    body: [
      'Read Article 6: «إذا انتهت مدة عقد الإيجار واستمر المستأجر شاغلًا للعقار دون اعتراض من المؤجر، يجدد العقد لمدة أخرى مماثلة أو لمدة سنة أيهما أقل وبذات شروط العقد الأخرى».',
      'Break it into its conditions: the term ends; neither party gives notice of non-renewal or of wanting different terms; the tenant stays in possession without the landlord objecting. The effect: the lease continues on the same terms and conditions, renewed for one year or the same period, whichever is shorter, at the same rent and ancillaries.',
      'Drill the calculation: a two-year lease renews for one year; a six-month lease renews for six months; a three-year lease renews for one year.',
      'Then the consequence that matters for a government landlord: the entity that wants to raise the rent or recover the premises and says nothing is renewed on the old terms. Ask: the lease expired, the tenant stayed, the entity wanted a higher rent but sent no notice — what rent applies? (The same rent.)',
    ].join('\n\n'),
  },

  // ── 5. Exceptions: non-renewal and eviction grounds ───────────────────
  {
    id: 'lsn_m3_05_exceptions',
    title: 'المحور الثالث — 5. القسم الثالث: الاستثناء — موانع التجديد والإخلاء',
    summary: 'Arts. 13–14 (amend on renewal), Art. 25(1) nine grounds before expiry, Art. 25(2) four grounds at expiry.',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'Explain the three ways out of automatic renewal: non-renewal or renewal on new terms; eviction before expiry; eviction at expiry',
      'Apply Arts. 13 and 14: amending terms or rent on renewal, Committee sets a fair rent if no agreement, 90 days\' notice before expiry unless agreed otherwise',
      'List the nine exhaustive grounds for eviction before expiry in Art. 25(1), including the 30-day notice for non-payment and for breach of any obligation',
      'List the four exhaustive grounds for eviction at expiry in Art. 25(2) and their conditions (permits, Dubai Municipality report, no suitable alternative property)',
      'Classify a given reason correctly as a before-expiry ground, an at-expiry ground, or no ground at all',
    ],
    body: [
      'Frame: automatic renewal is the rule; this lesson is the exceptions.',
      'Amendment on renewal (Arts. 13–14): for renewal, either party may before expiry amend any term or review the rent up or down; failing agreement, the Committee sets a fair rent using the Art. 9 criteria. A party wanting to amend must notify the other at least ninety days before expiry, unless otherwise agreed.',
      'Article 25(1) — eviction before the end of the term, exclusively (حصرًا) in these cases: (a) non-payment of rent or any part within 30 days of the landlord\'s notice to pay, unless otherwise agreed; (b) sub-letting all or part without the landlord\'s written consent — eviction then covers the sub-tenant, who may claim compensation from the tenant; (c) use, or allowing use, for an unlawful purpose or against public order or morals; (d) a commercial premises left unoccupied without lawful reason for 30 consecutive or 90 intermittent days in one year, unless otherwise agreed; (e) a change that affects the property\'s safety so it cannot be restored, or damage by deliberate act, gross negligence, or allowing others to cause it; (f) use for a purpose other than the agreed one, or contrary to planning, building and land-use rules; (g) the property is about to collapse, proved by a technical report issued or approved by Dubai Municipality; (h) failure to observe any obligation under the law or any term of the lease within 30 days of the landlord\'s notice to perform it; (i) urban-development requirements needing demolition and rebuilding as decided by the competent authorities. Notice for paragraph (1) is by notary public or registered post.',
      'Article 25(2) — eviction at the end of the lease, exclusively in these cases: (a) the owner wants to demolish and rebuild, or add new buildings preventing the tenant\'s use, provided the necessary permits are obtained; (b) the property needs restoration or comprehensive maintenance that cannot be done with the tenant in place, confirmed by a Dubai Municipality technical report; (c) the owner wants it for personal use or for a first-degree relative, provided he proves he owns no suitable alternative; (d) the owner wants to sell. The landlord must notify the tenant of the reasons at least twelve months before the eviction date, by notary public or registered post.',
      'Check by classification: give reasons one at a time — sale; sub-letting without consent; personal use; a shop closed 35 days in a row; "the entity wants a new tenant who pays more" — and make the learner place each before expiry, at expiry, or no ground. The last one is no ground: the list is exhaustive; the route there is Arts. 13–14.',
    ].join('\n\n'),
  },

  // ── 6. Notice form and deadlines ──────────────────────────────────────
  {
    id: 'lsn_m3_06_notice',
    title: 'المحور الثالث — 6. القسم الرابع: شكل الإخطار ومواعيده',
    summary: 'Who notifies whom, in what form, by when, and from which date the notice takes effect — for each way of ending the lease.',
    duration_min: 8,
    cpd_points: 1,
    objectives: [
      'Define the notice for Art. 14 purposes: written, by notary public, registered post, hand delivery or any legally approved technical means',
      'Match each termination route to its form and deadline: Art. 14 — 90 days before expiry; Art. 25(1) — notary or registered post, 30 days to comply; Art. 25(2) — notary or registered post, at least 12 months before the eviction date',
      'Calculate the last notice date for a given expiry date',
      'Explain why proof of the notice date must be kept',
    ],
    body: [
      'For every route, the learner must answer: who notifies whom, in what form, when, and from what date the notice takes effect.',
      'Definition of notice used with Art. 14: a written notice from either party to the other by notary public, registered post, hand delivery, or any legally approved technical means.',
      'Compare the three. Amendment on renewal (Art. 14): any of those methods; at least 90 days before expiry unless agreed otherwise. Breach-based eviction before expiry (Art. 25(1)): notary public or registered post only; the tenant has 30 days from the notice to pay or to comply. Eviction at expiry (Art. 25(2)): notary public or registered post only; at least 12 months before the eviction date, stating the reasons.',
      'Test the form: the entity emailed a payment demand and filed for eviction 30 days later — what is the risk? Article 25 specifies notary or registered post for that notice; email alone does not meet it.',
      'Test the dates: lease ends 30 June, the entity wants a higher rent — last notice about 1 April (90 days). Lease ends 31 December, the owner wants to sell — notice by 31 December of the previous year (12 months).',
      'Close on evidence: deadlines run from the date of notice, so keep the notary\'s certificate or the registered-post receipt — the court will ask for it.',
    ].join('\n\n'),
  },

  // ── 7. Common eviction cases in practice ──────────────────────────────
  {
    id: 'lsn_m3_07_cases',
    title: 'المحور الثالث — 7. القسم الخامس: أبرز حالات الإخلاء عمليًا',
    summary: 'The eight most frequent grounds in litigation, with the evidential points and the legislative gap on demolition permits.',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'Work through the eight most common grounds: rent default, sub-letting, unlawful or wrong-purpose use, harmful alteration or damage, demolition/new building, restoration, personal use, sale',
      'Identify the proof each ground needs (notice and lapse of 30 days, written consent, Dubai Municipality report, permits, no suitable alternative property)',
      'Explain the legislative gap: the law does not say whether permits for demolition must be obtained before the notice or only by the end of the lease',
      'Discuss the burden and means of proving that the owner has no suitable alternative property for personal use',
    ],
    body: [
      'Teach this as practice, not recital. For each ground, ask the learner what they would need in the file to win.',
      'Rent and ancillaries: the most common. Notice to pay by notary or registered post, then 30 days without payment. Sub-letting: proof of the sub-letting and the absence of the landlord\'s written consent; the eviction reaches the sub-tenant too. Unlawful use, or use against public order or morals, or for a purpose other than agreed, or against planning and land-use rules. Alteration affecting safety that cannot be reversed, or damage by deliberate act or gross negligence, by the tenant or by others he allowed.',
      'Demolition and rebuilding, or adding buildings that prevent use: the permits are required. Present the gap exactly as the source does: the text does not settle whether the approvals must exist before the notice is sent or only by the end of the lease. Treat this as a discussion point, and ask the learner which approach is safer for a government landlord and why.',
      'Restoration or comprehensive maintenance: must be impossible with the tenant in place, and confirmed by a technical report issued or approved by Dubai Municipality.',
      'Personal use or a first-degree relative: the owner must prove he owns no suitable alternative property for that purpose. Discuss who bears the burden (the owner) and how it might be proved; do not state any specific evidential rule the lesson does not give.',
      'Sale: the owner\'s wish to sell, with 12 months\' notice by notary or registered post.',
      'Run two quick scenarios: (1) a shop closed 20 days in January, 40 in May and 35 in September without lawful reason — is abandonment made out? (Yes: over 30 consecutive in May, and over 90 intermittent in the year.) (2) sub-letting with only an oral approval from an employee — is the ground made out? (Prima facie yes: the law requires written consent.)',
    ].join('\n\n'),
  },

  // ── 8. Assessment ─────────────────────────────────────────────────────
  {
    id: 'lsn_m3_08_assessment',
    title: 'المحور الثالث — 8. التقييم النهائي',
    summary: 'Ten spoken questions with feedback. Pass mark 80% (eight of ten).',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'Apply the module across renewal, notice form and deadlines, and the eviction grounds',
      'Achieve the 80% pass mark (eight correct out of ten)',
    ],
    body: [
      'Run a spoken assessment in Arabic. Ask one question at a time; let the learner answer, then confirm the correct answer and the article. Eight or more out of ten is a pass.',
      'Q1. A three-year lease expires and the tenant stays without objection — for how long does it renew? One year (Art. 6).',
      'Q2. Notice period to change the rent on renewal? At least 90 days before expiry unless agreed otherwise (Art. 14).',
      'Q3. Form of notice for eviction under Art. 25(1)? Notary public or registered post.',
      'Q4. Notice period for eviction because the owner wants to sell? At least 12 months before the eviction date (Art. 25(2)).',
      'Q5. When can eviction be sought for non-payment? If the tenant does not pay within 30 days of the notice to pay (Art. 25(1)(a)).',
      'Q6. Conditions for eviction for leaving premises unoccupied? Commercial premises; 30 consecutive or 90 intermittent days a year; no lawful reason.',
      'Q7. How is a property about to collapse proved? A technical report issued or approved by Dubai Municipality.',
      'Q8. Name two grounds for eviction at expiry. Any two of: demolition/new building with permits; restoration with Municipality report; personal use with no suitable alternative; sale.',
      'Q9. Does filing an eviction claim suspend the rent? No — it is due until judgment is executed (Art. 31).',
      'Q10. No term stated, rent paid quarterly — what is the term? Three months (Art. 5).',
      'Give the score, pass or fail against 80%, and the one or two points to revisit.',
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
