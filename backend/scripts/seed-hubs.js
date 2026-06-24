'use strict';

// Seeds the knowledge hub for the Aviation Law course from the original
// hand-authored hub content, so the hub is populated on first deploy. Idempotent
// — it only seeds a course_id that has no hub yet, and never overwrites edits
// made by an admin.

const hubStore = require('../src/services/hubStore');

const AVIATION = {
  course_id: 'aviation-law',
  eyebrow: 'Continuing Legal Professional Development',
  title: 'Litigation & Arbitration in Aviation Law',
  intro: 'The international conventions and the UAE statutory regime that govern carrier liability, unfair competition, and the arbitration and enforcement of aviation disputes — with a live AI trainer to take you through it, one-to-one.',
  cta_label: 'Start the AI Training',
  cta_url: 'https://nice-ocean-0a45eff10.7.azurestaticapps.net/ai-trainer-live.html',
  published: true,
  legislation: [
    { group: 'intl', year: '1929', tag: 'Warsaw', title: 'Warsaw Convention', subtitle: 'Unification of certain rules relating to international carriage by air',
      summary: 'The foundation of carrier liability. Its key move is to reverse the burden of proof in favour of the passenger or shipper.',
      points: ['The consumer need not prove the carrier’s fault', 'Carrier escapes liability only by proving it took all necessary measures — or that this was impossible', 'Contributory fault of the injured party is a defence'] },
    { group: 'intl', year: '1944', tag: 'Chicago', title: 'Chicago Convention', subtitle: 'International civil aviation — established ICAO',
      summary: 'Harmonises international air navigation and underpins the closed list of jurisdictions that constrains where aviation disputes may be brought.',
      points: ['Created the International Civil Aviation Organization (ICAO)', 'Source of harmonised air-transport rules', 'Frames the mandatory local jurisdiction that carries into arbitration'] },
    { group: 'intl', year: '1963', tag: 'Tokyo', title: 'Tokyo Convention', subtitle: 'Offences and certain other acts committed on board aircraft',
      summary: 'Governs jurisdiction over offences and acts affecting safety committed on board, and the powers of the aircraft commander.',
      points: ['Jurisdiction of the state of registration', 'Powers of the aircraft commander', 'Part of the wider safety-and-security framework'] },
    { group: 'intl', year: '1999', tag: 'Montreal', title: 'Montreal Convention', subtitle: 'Unification of certain rules for international carriage by air',
      summary: 'Modernises Warsaw: introduces objective (risk-based) liability, mixed with fault, across three categories of claim.',
      points: ['Three categories: passenger death/injury & baggage; cargo; delay', 'Two-tier passenger liability around the SDR threshold (strict up to it; defence of no-fault above)', 'Each category carries its own defences'] },
    { group: 'intl', year: '1958', tag: 'New York', title: 'New York Convention', subtitle: 'Recognition & enforcement of foreign arbitral awards',
      summary: 'The backbone of cross-border enforcement. The UAE is a party, so foreign aviation arbitral awards are recognised and enforced subject to its limited grounds of refusal.',
      points: ['Pro-enforcement regime for foreign awards', 'Narrow, exhaustive grounds to refuse recognition', 'Central to enforcing aviation arbitration outcomes'] },
    { group: 'uae', year: 'Law 18/1993', tag: 'Ch. V', title: 'Commercial Transactions Law', subtitle: 'Chapter V — air transportation · amended by Decree-Law 14/2020',
      summary: 'The onshore UAE carrier-liability regime, applying without prejudice to the international conventions. Covers death/injury, baggage and cargo, and delay.',
      points: ['Death/injury: not less than the Sharia diyah', 'Baggage & goods: 150 AED per kg · small items 3,000 AED', 'Notice: 7 days baggage · 14 days goods · 21 days delay · 2-year limitation', 'Limitation lost for intent or reckless conduct with knowledge'] },
    { group: 'uae', year: 'Law 20/1991', tag: 'Civil Aviation', title: 'Civil Aviation Law', subtitle: 'Federal Act on Civil Aviation',
      summary: 'The principal UAE statute organising civil aviation — registration, operation and safety of aircraft — within which the liability and dispute rules operate.',
      points: ['Framework for civil aviation in the UAE', 'Operates alongside the international conventions', 'Context for the commercial-liability regime'] },
    { group: 'uae', year: 'Law 11/1992', tag: 'Art. 235', title: 'Civil Procedure Law', subtitle: 'Article 235 (as amended) — enforcement of foreign judgments & awards',
      summary: 'The route to enforce a foreign judgment or arbitral award in the UAE: petition the enforcement judge, who issues an order within 5 working days, challengeable by appeal.',
      points: ['Enforcement on the same conditions that country applies to UAE judgments', 'Order within 5 working days · appealable', 'Conditions: jurisdiction, due process, finality, no conflict, public order'] },
    { group: 'uae', year: 'Law 6/2018', tag: 'Arbitration', title: 'Federal Arbitration Law', subtitle: 'Federal Decree-Law on Arbitration',
      summary: 'The modern UAE arbitration framework that supports aviation arbitration — the courts’ supporting role (tribunal, interim measures, evidence) and supervisory role over the award.',
      points: ['Supporting role: constituting the tribunal, interim measures, evidence', 'Supervisory role: recognition, enforcement and challenge', 'Works with the New York Convention for foreign awards'] },
  ],
  faq: [
    { q: 'Which applies first — the conventions or UAE law?', a: 'The international conventions take precedence. UAE law (Chapter V of Law 18/1993, as amended by Decree-Law 14/2020) applies <b>without prejudice to the international agreements to which the State is a party</b> — so where Warsaw 1929 or Montreal 1999 governs, they come first; UAE law fills the onshore detail.' },
    { q: 'How does the Warsaw Convention change the burden of proof?', a: 'It <b>reverses</b> it. The passenger or shipper does not have to prove the carrier’s fault. To escape liability the carrier must prove it and its agents took all necessary measures to prevent the damage (or that doing so was impossible), and may rely on the injured party’s contributory fault.' },
    { q: 'What are the three Montreal liability categories?', a: '(1) <b>Passenger death/injury and baggage</b>; (2) <b>cargo</b>; and (3) <b>delay</b>. Montreal mixes objective (risk-based) liability with fault-based liability, and each category carries its own defences. Passenger death/injury is two-tier around the SDR threshold — strict up to it, with a no-fault defence above.' },
    { q: 'What are the UAE compensation limits?', a: 'For death or injury, <b>not less than the Sharia diyah</b>. For baggage and goods, <b>150 AED per kilogram</b>; for small personal items kept by the passenger, <b>3,000 AED</b>. A higher limit applies where the value was declared and any supplementary fee paid (the declared-value exception).' },
    { q: 'What notice deadlines and limitation period apply under UAE law?', a: 'Notice must be given within <b>7 days</b> for baggage, <b>14 days</b> for goods and <b>21 days</b> for delay. The limitation period for the claim is <b>2 years</b>.' },
    { q: 'When does the carrier lose the limitation of liability?', a: 'Where the damage results from the carrier’s <b>intent</b>, or from <b>recklessness with knowledge</b> that damage would probably result. In those cases the statutory caps fall away.' },
    { q: 'Can the parties freely choose the arbitration seat?', a: 'No — the freedom is <b>restricted</b>. ICAO/Chicago harmonisation and the Montreal Convention 1999 set a closed list of options for where proceedings may be brought, and deviation is null and void. Because the seat shapes the whole arbitration, this matters a great deal.' },
    { q: 'How is a foreign award enforced in the UAE?', a: 'Through <b>Article 235</b> of the Civil Procedure Law (Law 11/1992, as amended): petition the enforcement judge, who issues an order within <b>5 working days</b>, challengeable by appeal — enforcement on the same conditions that country applies to UAE judgments. For arbitral awards the <b>New York Convention 1958</b> governs recognition and enforcement.' },
    { q: 'What is the unfair-competition claim in air transport?', a: 'A <b>special claim</b> (not an ordinary tort) giving civil and criminal protection across borders. Three conditions: an act of unfair competition, damage, and a causal link. Unlawful methods include <b>distortion</b> (denigration), <b>confusion</b>, and <b>disruption</b>; remedies run from stopping the acts and compensation to publication of the judgment and custodial sentences.' },
  ],
};

function run() {
  try {
    if (hubStore.getHub(AVIATION.course_id)) {
      console.log('[seed-hubs] aviation-law hub already present — leaving as-is');
      return;
    }
    hubStore.upsertHub(AVIATION, 'seed');
    console.log('[seed-hubs] seeded aviation-law knowledge hub');
  } catch (e) {
    console.error('[seed-hubs] failed:', e.message);
  }
}

run();
