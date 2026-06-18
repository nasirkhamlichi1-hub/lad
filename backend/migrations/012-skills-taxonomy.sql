-- 012-skills-taxonomy.sql
-- Seeds the controlled skills taxonomy that powers the "smart courses"
-- ecosystem. Courses are meta-tagged against these topics (course_topics);
-- attendance then writes skill_events, building each lawyer's skill graph and
-- driving gap-based recommendations.
--
-- Two levels: level 1 = domain (radar axis), level 2 = topic (taggable).
-- IDs are stable slugs so the tagger and frontend can reference them.

INSERT OR IGNORE INTO taxonomies (id, parent_id, label, domain, level, display_order) VALUES
  -- ── Domains (level 1) ──
  ('dr',    NULL, 'Dispute Resolution & Arbitration', 'dr',    1, 10),
  ('corp',  NULL, 'Corporate & Commercial',           'corp',  1, 20),
  ('fin',   NULL, 'Banking, Finance & Tax',           'fin',   1, 30),
  ('reg',   NULL, 'Regulatory & Compliance',          'reg',   1, 40),
  ('rec',   NULL, 'Real Estate & Construction',       'rec',   1, 50),
  ('emp',   NULL, 'Employment & Human Capital',       'emp',   1, 60),
  ('tech',  NULL, 'Technology, AI & Ethics',          'tech',  1, 70),
  ('skill', NULL, 'Core Lawyering Skills',            'skill', 1, 80),

  -- ── Dispute Resolution ──
  ('dr.arb-intl',   'dr', 'International Arbitration',        'dr', 2, 11),
  ('dr.arb-difc',   'dr', 'DIFC / ADGM Arbitration',         'dr', 2, 12),
  ('dr.litigation', 'dr', 'Civil Litigation & UAE Courts',   'dr', 2, 13),
  ('dr.mediation',  'dr', 'Mediation & ADR',                 'dr', 2, 14),
  ('dr.enforce',    'dr', 'Award Recognition & Enforcement', 'dr', 2, 15),

  -- ── Corporate & Commercial ──
  ('corp.ma',         'corp', 'Mergers & Acquisitions',     'corp', 2, 21),
  ('corp.governance', 'corp', 'Corporate Governance',       'corp', 2, 22),
  ('corp.contracts',  'corp', 'Commercial Contracts',       'corp', 2, 23),
  ('corp.companies',  'corp', 'Company Law & Formation',    'corp', 2, 24),
  ('corp.insolvency', 'corp', 'Insolvency & Restructuring', 'corp', 2, 25),

  -- ── Banking, Finance & Tax ──
  ('fin.banking', 'fin', 'Banking & Finance',          'fin', 2, 31),
  ('fin.tax',     'fin', 'Tax & VAT',                  'fin', 2, 32),
  ('fin.crypto',  'fin', 'Crypto Assets & CARF',       'fin', 2, 33),
  ('fin.capital', 'fin', 'Capital Markets',            'fin', 2, 34),

  -- ── Regulatory & Compliance ──
  ('reg.aml',       'reg', 'Anti-Money Laundering (AML/CFT)', 'reg', 2, 41),
  ('reg.sanctions', 'reg', 'Sanctions & Targeted Financial Sanctions', 'reg', 2, 42),
  ('reg.data',      'reg', 'Data Protection & Privacy',       'reg', 2, 43),
  ('reg.competition','reg','Competition & Antitrust',         'reg', 2, 44),
  ('reg.esg',       'reg', 'ESG & Sustainability',            'reg', 2, 45),

  -- ── Real Estate & Construction ──
  ('rec.realestate',   'rec', 'Real Estate Law',            'rec', 2, 51),
  ('rec.construction', 'rec', 'Construction & FIDIC',       'rec', 2, 52),
  ('rec.property-disp','rec', 'Property & Owners Disputes',  'rec', 2, 53),

  -- ── Employment & Human Capital ──
  ('emp.employment', 'emp', 'Employment & Labour Law',  'emp', 2, 61),
  ('emp.immigration','emp', 'Immigration & Visas',      'emp', 2, 62),

  -- ── Technology, AI & Ethics ──
  ('tech.ai-gov',    'tech', 'AI Governance & Legal Risk',   'tech', 2, 71),
  ('tech.ai-use',    'tech', 'Responsible Use of AI',        'tech', 2, 72),
  ('tech.legaltech', 'tech', 'Legal Technology & Innovation','tech', 2, 73),
  ('tech.ethics',    'tech', 'Professional Ethics & Conduct','tech', 2, 74),
  ('tech.ip',        'tech', 'Intellectual Property & Tech', 'tech', 2, 75),

  -- ── Core Lawyering Skills ──
  ('skill.drafting', 'skill', 'Legal Drafting',          'skill', 2, 81),
  ('skill.advocacy', 'skill', 'Advocacy & Negotiation',  'skill', 2, 82),
  ('skill.research', 'skill', 'Legal Research & Analysis','skill', 2, 83);
