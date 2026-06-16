'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Seed: "Litigation & Arbitration in Aviation Law" CLPD session.
// ─────────────────────────────────────────────────────────────────────────
// Built from the LAD CLPD seminar deck by Dr Ashraf Amin Farag. Loads the
// programme into the AI Trainer as linked lessons (course_id = 'aviation-law'):
// carrier liability (Warsaw/Montreal), carrier liability under UAE law, unfair
// competition, arbitration in international aviation disputes, the role of the
// national courts & enforcement, and a final assessment.
//
//   node scripts/seed-trainer-aviation.js
//
// Idempotent: stable ids, so re-running updates the lessons in place.
//
// Source-anchored: figures and article numbers (113,000 SDR; 150 AED/kg;
// 3,000 AED; 7/14/21-day notice; 2-year limitation; Article 359; UAE Law
// 18/1993 as amended by Decree-Law 14/2020; Article 235 of Law 11/1992;
// New York Convention 1958) are taken from the deck. Confirm against the
// official texts before relying on them in practice.

require('dotenv').config();
const trainerStore = require('../src/services/trainerStore');

const COURSE = 'aviation-law';

const DISCLAIMER =
  'Teaching note: this is informational CLPD, not legal advice (per the LAD disclaimer). Present it as a ' +
  'structured practitioner summary, and tell the lawyer that the authoritative sources are the conventions ' +
  'and the cited UAE/Egyptian statutes themselves, which should be checked before being relied upon.';

const LESSONS = [
  // ── 0. Welcome ────────────────────────────────────────────────────────
  {
    id: 'lsn_av_00_welcome',
    title: 'Aviation Law — Welcome & How This Works',
    summary: 'Orientation to the seminar on litigation and arbitration in aviation law, and how the session runs.',
    duration_min: 5,
    cpd_points: 0,
    objectives: [
      'Understand the three parts of the programme: carrier liability, unfair competition, and arbitration/enforcement',
      'Know that the session is informational CLPD and not legal advice',
      'Understand the conversational format and the 80% pass mark on the final assessment',
    ],
    body: [
      'This is a continuing legal professional development (CLPD) seminar of the Dubai Government Legal Affairs Department on litigation and arbitration in aviation law, based on the programme by Dr Ashraf Amin Farag. It is written for practising lawyers.',
      'Explain the shape of the programme. It has three parts. First, the liability of the air carrier — under the international conventions (Warsaw 1929 and Montreal 1999) and then under UAE law. Second, the unfair-competition claim in air transport. Third, arbitration in international aviation disputes and the role of the national courts in supporting and supervising it, including enforcement of awards.',
      'Tell the lawyer how this works: it is a spoken one-to-one, not a lecture. You move through the key elements one at a time, checking understanding before moving on, and you keep their attention as you go. At the end there is a short assessment of five questions; four correct out of five is a pass, and completion is recorded against their CLPD record.',
      DISCLAIMER,
    ].join('\n\n'),
  },

  // ── 1. Carrier liability under the international conventions ───────────
  {
    id: 'lsn_av_01_conventions',
    title: 'Section 01 — Carrier Liability: Warsaw & Montreal Conventions',
    summary: 'The international framework: reversed burden of proof under Warsaw 1929 and the three liability categories of Montreal 1999.',
    duration_min: 18,
    cpd_points: 1,
    objectives: [
      'Explain how the Warsaw Convention 1929 reverses the burden of proof in favour of the passenger or shipper',
      'Explain that the Montreal Convention 1999 introduced objective (risk-based) liability and how it mixes fault-based and objective liability',
      'Distinguish the three Montreal categories: passenger death/injury & baggage; cargo; and delay',
      'State the 113,000 SDR threshold for passenger death/injury and what changes above it',
      'List the carrier\'s defences in each category',
    ],
    body: [
      'Teach the international framework before the UAE detail, because UAE law applies "without prejudice to the international agreements to which the State is a party".',
      'Start with the Warsaw Convention of 1929. Its key move is to reverse the burden of proof. The aviation consumer — passenger or shipper — does not have to prove the carrier\'s fault. To escape liability, the carrier must prove that it and its agents took all necessary measures to prevent the damage, or that it was impossible to do so, and that the injured party caused or contributed to the damage. Ask the lawyer why a reversed burden matters so much to how an aviation claim is run.',
      'Now the Montreal Convention of 1999, which established objective liability based on risk and the assumption of consequences. It is not purely objective — it mixes fault-based and objective liability across three categories. Walk through them one at a time.',
      'Category one — death or injury to a passenger, and damaged baggage. Liability is objective up to 113,000 Special Drawing Rights (SDR) per passenger: the carrier cannot exclude or limit it within that ceiling. Above 113,000 SDR, liability becomes contractual and based on presumed fault — the carrier can deny only by proving the damage was not due to its (or its people\'s) negligence, error or omission, or was solely due to a third party.',
      'Category two — cargo (goods). Here the Convention adopts strict liability based on risk. The carrier escapes only by proving a listed cause: a latent or inherent defect or the nature of the goods; poor packing by someone other than the carrier or its people; an act of war or armed conflict; or measures taken by public authorities controlling the entry and exit of goods.',
      'Category three — delay. The Convention adopts contractual liability based on presumed fault. The carrier escapes by proving that it, its employees and its agents took all reasonable measures to avoid the damage, or that it was impossible to take them.',
      'Summarise the three situations in which a carrier may be liable under Montreal 1999: bodily injury to passengers; destruction, loss or damage to goods or baggage; and damage from delay. And the three routes to deny liability: the injured party was at fault; no fault and all reasonable measures were taken; or the act of a third party. Check the lawyer can match each category to its liability basis (objective vs presumed fault) before moving on.',
    ].join('\n\n'),
  },

  // ── 2. Carrier liability under UAE law ────────────────────────────────
  {
    id: 'lsn_av_02_uae_liability',
    title: 'Section 02 — Carrier Liability under UAE Law',
    summary: 'Chapter V of the Commercial Transactions Law (Law 18/1993, amended by Decree-Law 14/2020): scope, compensation limits, notice deadlines, jurisdiction and limitation.',
    duration_min: 18,
    cpd_points: 1,
    objectives: [
      'Identify the UAE source: Chapter V of Federal Law No. 18 of 1993, as amended by Decree-Law No. 14 of 2020',
      'State when the carrier is liable (death/injury, lost or damaged baggage/cargo, and delay) and the small-items exception',
      'Apply the compensation limits: not less than the Sharia diyah for death/injury; 150 AED/kg for baggage/goods; 3,000 AED for small items; and the declared-value exception',
      'Apply the notice deadlines (7 days baggage, 14 days goods, 21 days delay) and the 2-year limitation period',
      'Explain when the carrier loses the limitation of liability (intent or recklessness with knowledge) and the rules on jurisdiction and successive carriers',
    ],
    body: [
      'Now the onshore UAE regime. The legislator devoted Chapter V of the Federal Commercial Transactions Law No. 18 of 1993, as amended by Decree-Law No. 14 of 2020, to air transportation. It applies "without prejudice to international agreements to which the State is a party". Air transportation means carrying passengers, baggage and cargo by aircraft for a fee.',
      'When is the carrier liable? For death or injury to a passenger occurring during air transportation or while boarding or disembarking; for the destruction, loss or damage of registered baggage and cargo where the incident occurred during air transportation (the period the items are under the carrier\'s supervision in flight or at an airport — not land/sea legs outside the airport); and for damage from delay in the arrival of a passenger, checked baggage or goods. Note the exception: the carrier is not liable for small personal items kept under the passenger\'s own supervision unless the passenger proves the carrier failed to take necessary measures.',
      'Compensation limits — teach these precisely. For death or injury, compensation may not be less than the prescribed Sharia blood money (diyah), and the parties may agree a higher amount. For baggage and goods, compensation may not exceed 150 dirhams per kilogram, unless a higher amount is agreed or unless the consignor declared a special higher value (and paid any extra fee) on handover — in which case the carrier pays up to the declared value, unless it proves that value exceeds the real value. For small items kept with the passenger, compensation may not exceed 3,000 dirhams per passenger.',
      'Critically, the carrier cannot rely on the limitation of liability if the damage resulted from its (or its employees\') act or omission done with intent to cause damage, or recklessly and with knowledge that damage would probably result. For employees, it must also be shown the act occurred while performing their duties. The air waybill must state that carriage is under the liability provisions (Article 359); any clause exempting the carrier or cutting liability below Article 359 is null and void — except for loss from the inherent nature of, or an inherent defect in, the item.',
      'Procedure and time limits. If goods or baggage are taken without reservation, that is treated as acceptance in good condition, and the burden shifts to the consignor to prove otherwise. Damage must be notified within at least 7 days for baggage and 14 days for goods from receipt; for delay, a claim within a maximum of 21 days from handover. No liability suit lies unless that prior notice was given — unless the claimant proves the carrier acted fraudulently to conceal the damage or avoid the deadlines.',
      'Finally, defences, forum and limitation. The carrier is exempt if the loss was caused by the injured party, and the court may reduce liability where the injured party contributed (contributory fault). The plaintiff may sue in the court of the carrier\'s residence, its main place of business, the establishment that signed the contract on its behalf, or the Court of First Instance; any clause changing this before the damage occurs is void. With successive carriers, each is responsible for its part, but a carrier that contracted for the whole journey is liable for every part even if it did not perform it. And the liability claim will not be heard after two years from the aircraft\'s arrival, its scheduled arrival, or the stoppage of the carriage. Check the lawyer can recall the three notice deadlines and the two-year bar.',
    ].join('\n\n'),
  },

  // ── 3. Unfair competition ─────────────────────────────────────────────
  {
    id: 'lsn_av_03_unfair_competition',
    title: 'Section 03 — Unfair Competition in Air Transport',
    summary: 'Scope, the three conditions, the methods (distortion, confusion, disruption), who may sue and be sued, and the penalties.',
    duration_min: 15,
    cpd_points: 1,
    objectives: [
      'Explain the scope of the unfair-competition claim: a special claim giving civil and criminal protection, nationally and internationally',
      'Apply the three conditions: an act of unfair competition, damage, and a causal link',
      'Distinguish the unlawful methods: distortion (denigration), confusion/ambiguity, and disruption',
      'Identify who may sue (the competing carrier; exceptionally associations, unions, chambers; the Public Prosecution) and who may be sued (jointly and severally)',
      'List the penalties: stopping the acts, compensation, publication of the judgment, and custodial sentences',
    ],
    body: [
      'Move to the unfair-competition claim in air transport. Frame it correctly: it is not an ordinary tort claim — it is a special claim protecting a particular right, giving both civil and criminal protection, and it reaches beyond national borders, which fits an industry whose activities cross frontiers.',
      'Teach the three conditions in order. One — an act of unfair competition, which itself needs two elements: a competitive situation, and the use of unfair, unlawful methods within it. Two — damage resulting from that unlawful conduct. Three — a causal link between the unlawful conduct and the damage, with the burden of proving causation on the claimant.',
      'Then the unlawful methods. Distortion (denigration): conduct aimed at undermining a rival airline or its services — and note the sharp point that this is tortious even if the facts stated are true, because liability rests on the act of denigration itself. Confusion or ambiguity: instead of repelling customers, this attracts them, by mimicking a rival\'s image or services so customers confuse the two. Disruption: sowing chaos, for example luring away a competitor\'s staff or spreading false rumours about its service quality.',
      'Who are the parties? The plaintiff is normally a competing airline that is a direct victim; exceptionally, consumer-protection associations, unions, and chambers of commerce and industry may sue, and the Public Prosecution may act in some cases, such as prohibited symbols. The defendant may be any natural or legal person, public or private, including accomplices, all jointly and severally liable.',
      'Finally the penalties: an order to stop the unlawful acts; a judgment for compensation; publication of the judgment in the newspapers at the offender\'s expense; and, in appropriate cases, custodial sentences such as imprisonment. Ask the lawyer to give an example of each of the three methods before you close.',
    ].join('\n\n'),
  },

  // ── 4. Arbitration in international aviation disputes ──────────────────
  {
    id: 'lsn_av_04_arbitration',
    title: 'Section 04 — Arbitration in International Aviation Disputes',
    summary: 'The restricted choice of seat under the conventions, the arbitral procedure, and how the applicable law and arbitrable subject-matter are determined.',
    duration_min: 16,
    cpd_points: 1,
    objectives: [
      'Explain how international conventions restrict the parties\' freedom to choose the place (seat) of aviation arbitration, and why the seat matters',
      'Outline the arbitral procedure: agreement to arbitrate, the request, constituting the tribunal, the hearings, and the language',
      'Explain how the applicable law is determined and the arbitral tribunal\'s role in finding it',
      'Identify the disputes typically arbitrated: compensation for unfair competition, and restoring economic balance in the carriage contract',
    ],
    body: [
      'Turn to arbitration of international aviation disputes. Begin with a feature that surprises people: the parties\' freedom to choose the seat is restricted. ICAO has harmonised air-transport rules, and the Montreal Convention 1999 sets out a closed list of options for where proceedings may be brought; deviation from those options is null and void. This mandatory local jurisdiction carries over into arbitration, and because the seat governs so much of the process, it matters a great deal. Teach this in two steps: first, the seat is fixed by reference to the international agreements; second, the seat then shapes the whole arbitration.',
      'Walk through the procedure as five steps: the parties\' freedom to decide whether to arbitrate at all; the claimant\'s submission of the arbitration request; the appointment of the arbitrator or constitution of the tribunal; the conduct of the hearings (the "session system"); and the language of the arbitration.',
      'Then the applicable law. Under Montreal 1999 the legal framework for aviation arbitration has a specificity that sets it apart from ordinary litigation. It falls to the arbitral tribunal to determine the law applicable to the dispute and the nature of the matters that may be arbitrated. The tribunal both searches for the law applicable to the subject of the claim and interprets the jurisprudence on applying the Convention\'s rules to the dispute.',
      'Finally, the arbitrable subject-matter. Compensation for unfair competition is a central subject for aviation arbitration, and a key role of the arbitrator is to restore the economic balance between the parties to the carriage contract. Check the lawyer can explain why the choice of seat is not freely negotiable, and can list at least three of the five procedural steps, before moving on.',
    ].join('\n\n'),
  },

  // ── 5. National courts & enforcement ──────────────────────────────────
  {
    id: 'lsn_av_05_courts_enforcement',
    title: 'Section 05 — National Courts & Enforcement of Awards',
    summary: 'The supporting and supervisory role of the national judiciary, UAE enforcement under Article 235, and the Egyptian/New York Convention position.',
    duration_min: 14,
    cpd_points: 1,
    objectives: [
      'Distinguish the supporting role of the national courts (constituting the tribunal, interim measures, evidence) from their supervisory role (recognition, enforcement and challenge)',
      'Apply the UAE enforcement route under Article 235 of Law 11/1992 (as amended): petition to the enforcement judge, order within 5 working days, challengeable by appeal',
      'List the conditions for enforcing a foreign judgment/award under UAE law',
      'Explain the Egyptian-law position and the role of the New York Convention 1958 on recognition and enforcement of foreign arbitral awards',
    ],
    body: [
      'Close the arbitration part with the courts. The national judiciary plays two roles. A supporting role during the arbitration: helping constitute the tribunal, ordering precautionary and temporary measures, and assisting with evidence. And a supervisory role over the award: at the recognition and enforcement stage, and at the stage of any challenge to the award\'s validity.',
      'Take UAE enforcement first. Article 235 of the Federal Civil Procedure Law No. 11 of 1992 — as amended (Cabinet Decision 57 of 2018, Federal Decree-Law 15 of 2021, Cabinet Decision 75 of 2021) — allows foreign judgments and orders to be enforced on the same conditions that country would apply to UAE judgments. Enforcement is sought by petition to the enforcement judge, who issues the order within a maximum of five working days, and the order may be challenged by appeal.',
      'Teach the conditions for an enforcement order: the UAE courts do not have exclusive jurisdiction over the dispute and the foreign court did have jurisdiction under its own rules; the judgment was issued by a competent court and is duly authenticated; the parties were summoned and properly represented; the judgment is final (res judicata) under its own law; and it does not conflict with a prior UAE ruling and contains nothing contrary to public order or morality.',
      'Then the Egyptian-law comparison. For a foreign arbitral award made outside Egypt, the principle of territorial jurisdiction applies: Egyptian courts lack jurisdiction to set it aside, even if Egyptian law governed it — and if asked to do so, the court must, on its own initiative, decline jurisdiction without referral. Article 5 of the New York Convention 1958 on the Recognition and Enforcement of Foreign Arbitral Awards requires a foreign award to be recognised and enforced unless it has been set aside or suspended where it was made, and enforcement may be refused only on the Convention\'s listed grounds. By contrast, an award made in Egypt — even under foreign procedural rules or a foreign institution — is set aside under Egyptian arbitration law, again following territorial jurisdiction.',
      'Check the lawyer can separate the supporting from the supervisory role, and can state the headline UAE rule: petition the enforcement judge, order within five working days, appealable.',
    ].join('\n\n'),
  },

  // ── 6. Final Assessment ───────────────────────────────────────────────
  {
    id: 'lsn_av_06_assessment',
    title: 'Section 06 — Final Assessment',
    summary: 'Five scored questions with feedback. Pass mark 80% (four of five).',
    duration_min: 10,
    cpd_points: 1,
    objectives: [
      'Apply the framework across carrier liability, UAE limits, unfair competition, arbitration and enforcement',
      'Achieve the 80% pass mark (four correct out of five)',
    ],
    body: [
      'Run this as a spoken assessment. Ask the five questions one at a time, let the lawyer answer in their own words, then confirm the correct answer and give the short explanation. Track the score; four or more correct out of five is a pass. Keep it encouraging.',
      'Question 1 — Montreal 1999. For death or injury to a passenger, up to what amount is the carrier\'s liability objective (it cannot exclude or limit it)? Correct answer: 113,000 SDR per passenger; above that, liability becomes presumed-fault and the carrier may have defences. Explanation: objective up to the ceiling, fault-based above it.',
      'Question 2 — UAE compensation limits. What is the default cap on compensation for baggage and goods under the UAE Commercial Transactions Law? Correct answer: 150 dirhams per kilogram — unless a higher amount is agreed or the consignor declared a higher value on handover (and paid any extra fee). Explanation: the declared-value mechanism lifts the cap to the declared value.',
      'Question 3 — Notice deadlines. Within what period must damage to goods be notified to the carrier? Correct answer: 14 days from receipt (7 days for baggage; 21 days for delay). Explanation: no liability suit lies without timely notice, unless fraud/concealment is proved.',
      'Question 4 — Limitation. By when must a liability claim against the carrier be brought? Correct answer: within two years from the aircraft\'s arrival, its scheduled arrival, or the stoppage of the carriage; after that it will not be heard. Explanation: a hard time-bar to diary carefully.',
      'Question 5 — Arbitration seat. Under the international conventions, how free are the parties to choose the place (seat) of aviation arbitration? Correct answer: not freely — the Montreal Convention 1999 sets a closed list of options and any deviation is null and void. Explanation: mandatory local jurisdiction restricts party autonomy, and the seat shapes the whole process.',
      'After the fifth question, give the score, confirm pass or fail against the 80% mark, and briefly recap the two or three points the lawyer should revisit.',
    ].join('\n\n'),
  },
];

function main() {
  console.log(`[seed] loading ${LESSONS.length} lessons for course "${COURSE}"…`);
  for (const L of LESSONS) {
    const saved = trainerStore.upsertLesson({ ...L, course_id: COURSE, language: 'English', active: true }, 'seed-aviation');
    console.log(`  ✓ ${saved.id}  ${saved.title}  (${saved.duration_min} min, ${saved.cpd_points} CPD, ${saved.objectives.length} key elements)`);
  }
  const totalMin = LESSONS.reduce((s, L) => s + (L.duration_min || 0), 0);
  const totalCpd = LESSONS.reduce((s, L) => s + (L.cpd_points || 0), 0);
  console.log(`\n[seed] done — ${LESSONS.length} lessons, ~${totalMin} min total, ${totalCpd} CPD points.`);
  console.log('[seed] They now appear in the AI Trainer (admin: lad-trainer-admin.html; lawyer: ai-trainer.html).');
}

main();
