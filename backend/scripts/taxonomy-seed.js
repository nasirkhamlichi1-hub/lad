'use strict';

// ─────────────────────────────────────────────────────────────────────
// LAD CLPD — Legal practice taxonomy (UAE-focused)
// ─────────────────────────────────────────────────────────────────────
// A controlled vocabulary used to fingerprint courses and build lawyer
// skill graphs. Around 220 nodes organised in 3 levels:
//   Level 1: domain (e.g. 'Dispute Resolution')
//   Level 2: area (e.g. 'Arbitration')
//   Level 3: topic (e.g. 'DIFC Arbitration')
//
// LAD admins curate this list in /lad-admin.html → Taxonomy. New courses
// can request taxonomy additions which go through a lightweight review.
// Importantly: providers cannot self-tag — the AI proposes, reviewers
// confirm.

module.exports = [
  // ─── DOMAIN: Dispute Resolution ───────────────────────────────────
  { id: 'dr', label: 'Dispute Resolution', label_ar: 'تسوية المنازعات', domain: 'dr', level: 1 },
    { id: 'dr.litigation', parent: 'dr', label: 'Litigation', domain: 'dr', level: 2 },
      { id: 'dr.litigation.civil', parent: 'dr.litigation', label: 'Civil Litigation (UAE Federal Courts)', domain: 'dr', level: 3 },
      { id: 'dr.litigation.commercial', parent: 'dr.litigation', label: 'Commercial Litigation', domain: 'dr', level: 3 },
      { id: 'dr.litigation.appellate', parent: 'dr.litigation', label: 'Appellate Practice', domain: 'dr', level: 3 },
      { id: 'dr.litigation.cassation', parent: 'dr.litigation', label: 'Court of Cassation Practice', domain: 'dr', level: 3 },
    { id: 'dr.arbitration', parent: 'dr', label: 'Arbitration', domain: 'dr', level: 2 },
      { id: 'dr.arbitration.difc', parent: 'dr.arbitration', label: 'DIFC-LCIA / DIFC Arbitration', domain: 'dr', level: 3 },
      { id: 'dr.arbitration.adgm', parent: 'dr.arbitration', label: 'ADGM Arbitration', domain: 'dr', level: 3 },
      { id: 'dr.arbitration.dac', parent: 'dr.arbitration', label: 'Dubai International Arbitration Centre (DIAC)', domain: 'dr', level: 3 },
      { id: 'dr.arbitration.icc', parent: 'dr.arbitration', label: 'ICC Arbitration', domain: 'dr', level: 3 },
      { id: 'dr.arbitration.investor_state', parent: 'dr.arbitration', label: 'Investor-State Arbitration', domain: 'dr', level: 3 },
      { id: 'dr.arbitration.uae_federal', parent: 'dr.arbitration', label: 'UAE Federal Arbitration Law', domain: 'dr', level: 3 },
    { id: 'dr.mediation', parent: 'dr', label: 'Mediation & ADR', domain: 'dr', level: 2 },
      { id: 'dr.mediation.commercial', parent: 'dr.mediation', label: 'Commercial Mediation', domain: 'dr', level: 3 },
      { id: 'dr.mediation.workplace', parent: 'dr.mediation', label: 'Workplace Mediation', domain: 'dr', level: 3 },
      { id: 'dr.mediation.family', parent: 'dr.mediation', label: 'Family Mediation', domain: 'dr', level: 3 },
    { id: 'dr.enforcement', parent: 'dr', label: 'Enforcement of Judgments', domain: 'dr', level: 2 },
      { id: 'dr.enforcement.local', parent: 'dr.enforcement', label: 'Local Enforcement', domain: 'dr', level: 3 },
      { id: 'dr.enforcement.cross_border', parent: 'dr.enforcement', label: 'Cross-Border Enforcement', domain: 'dr', level: 3 },
      { id: 'dr.enforcement.new_york', parent: 'dr.enforcement', label: 'New York Convention', domain: 'dr', level: 3 },

  // ─── DOMAIN: Corporate & Commercial ───────────────────────────────
  { id: 'cc', label: 'Corporate & Commercial', label_ar: 'الشركات والتجاري', domain: 'cc', level: 1 },
    { id: 'cc.formation', parent: 'cc', label: 'Company Formation & Structures', domain: 'cc', level: 2 },
      { id: 'cc.formation.onshore', parent: 'cc.formation', label: 'Onshore (Federal) Company Formation', domain: 'cc', level: 3 },
      { id: 'cc.formation.freezone', parent: 'cc.formation', label: 'Free Zone Companies', domain: 'cc', level: 3 },
      { id: 'cc.formation.difc', parent: 'cc.formation', label: 'DIFC Companies Law', domain: 'cc', level: 3 },
      { id: 'cc.formation.adgm', parent: 'cc.formation', label: 'ADGM Companies', domain: 'cc', level: 3 },
      { id: 'cc.formation.foreign_ownership', parent: 'cc.formation', label: '100% Foreign Ownership Reforms', domain: 'cc', level: 3 },
    { id: 'cc.ma', parent: 'cc', label: 'Mergers & Acquisitions', domain: 'cc', level: 2 },
      { id: 'cc.ma.private', parent: 'cc.ma', label: 'Private M&A', domain: 'cc', level: 3 },
      { id: 'cc.ma.public', parent: 'cc.ma', label: 'Public M&A & Takeovers', domain: 'cc', level: 3 },
      { id: 'cc.ma.dd', parent: 'cc.ma', label: 'Due Diligence', domain: 'cc', level: 3 },
    { id: 'cc.contracts', parent: 'cc', label: 'Commercial Contracts', domain: 'cc', level: 2 },
      { id: 'cc.contracts.drafting', parent: 'cc.contracts', label: 'Contract Drafting', domain: 'cc', level: 3 },
      { id: 'cc.contracts.civil_code', parent: 'cc.contracts', label: 'UAE Civil Code (Contracts)', domain: 'cc', level: 3 },
      { id: 'cc.contracts.exclusion', parent: 'cc.contracts', label: 'Exclusion & Limitation Clauses', domain: 'cc', level: 3 },
      { id: 'cc.contracts.assignment', parent: 'cc.contracts', label: 'Assignment of Debt & Novation', domain: 'cc', level: 3 },
      { id: 'cc.contracts.common_law', parent: 'cc.contracts', label: 'Common Law Contract Principles', domain: 'cc', level: 3 },
      { id: 'cc.contracts.poa', parent: 'cc.contracts', label: 'Powers of Attorney', domain: 'cc', level: 3 },
    { id: 'cc.governance', parent: 'cc', label: 'Corporate Governance', domain: 'cc', level: 2 },
      { id: 'cc.governance.boards', parent: 'cc.governance', label: 'Board Duties & Liability', domain: 'cc', level: 3 },
      { id: 'cc.governance.shareholder', parent: 'cc.governance', label: 'Shareholder Rights & Disputes', domain: 'cc', level: 3 },
    { id: 'cc.insolvency', parent: 'cc', label: 'Insolvency & Restructuring', domain: 'cc', level: 2 },
      { id: 'cc.insolvency.federal', parent: 'cc.insolvency', label: 'UAE Federal Bankruptcy Law', domain: 'cc', level: 3 },
      { id: 'cc.insolvency.difc', parent: 'cc.insolvency', label: 'DIFC Insolvency', domain: 'cc', level: 3 },

  // ─── DOMAIN: Financial Services & Regulation ──────────────────────
  { id: 'fs', label: 'Financial Services & Regulation', label_ar: 'الخدمات المالية', domain: 'fs', level: 1 },
    { id: 'fs.banking', parent: 'fs', label: 'Banking Law', domain: 'fs', level: 2 },
      { id: 'fs.banking.cb_uae', parent: 'fs.banking', label: 'CB UAE Regulation', domain: 'fs', level: 3 },
      { id: 'fs.banking.islamic', parent: 'fs.banking', label: 'Islamic Banking & Finance', domain: 'fs', level: 3 },
      { id: 'fs.banking.secured_lending', parent: 'fs.banking', label: 'Secured Lending & Collateral', domain: 'fs', level: 3 },
    { id: 'fs.capital_markets', parent: 'fs', label: 'Capital Markets', domain: 'fs', level: 2 },
      { id: 'fs.capital_markets.sca', parent: 'fs.capital_markets', label: 'SCA Regulation', domain: 'fs', level: 3 },
      { id: 'fs.capital_markets.dfsa', parent: 'fs.capital_markets', label: 'DFSA Regulation (DIFC)', domain: 'fs', level: 3 },
      { id: 'fs.capital_markets.fsra', parent: 'fs.capital_markets', label: 'FSRA Regulation (ADGM)', domain: 'fs', level: 3 },
      { id: 'fs.capital_markets.listings', parent: 'fs.capital_markets', label: 'Equity Listings & IPOs', domain: 'fs', level: 3 },
    { id: 'fs.aml', parent: 'fs', label: 'AML / CTF / Sanctions', domain: 'fs', level: 2 },
      { id: 'fs.aml.uae_framework', parent: 'fs.aml', label: 'UAE AML Framework', domain: 'fs', level: 3 },
      { id: 'fs.aml.kyc', parent: 'fs.aml', label: 'KYC & Customer Due Diligence', domain: 'fs', level: 3 },
      { id: 'fs.aml.sanctions', parent: 'fs.aml', label: 'International Sanctions', domain: 'fs', level: 3 },
      { id: 'fs.aml.fatf', parent: 'fs.aml', label: 'FATF Compliance', domain: 'fs', level: 3 },
    { id: 'fs.fintech', parent: 'fs', label: 'Fintech & Payments', domain: 'fs', level: 2 },
      { id: 'fs.fintech.crypto', parent: 'fs.fintech', label: 'Virtual Assets & Crypto', domain: 'fs', level: 3 },
      { id: 'fs.fintech.vara', parent: 'fs.fintech', label: 'VARA Regulation (Dubai)', domain: 'fs', level: 3 },
      { id: 'fs.fintech.payments', parent: 'fs.fintech', label: 'Stored Value & Payment Services', domain: 'fs', level: 3 },

  // ─── DOMAIN: Real Estate & Construction ───────────────────────────
  { id: 're', label: 'Real Estate & Construction', label_ar: 'العقارات والبناء', domain: 're', level: 1 },
    { id: 're.transactions', parent: 're', label: 'Real Estate Transactions', domain: 're', level: 2 },
      { id: 're.transactions.sale_purchase', parent: 're.transactions', label: 'Sale & Purchase', domain: 're', level: 3 },
      { id: 're.transactions.offplan', parent: 're.transactions', label: 'Off-Plan Sales (Law 8 of 2007)', domain: 're', level: 3 },
      { id: 're.transactions.rera', parent: 're.transactions', label: 'RERA Regulation', domain: 're', level: 3 },
    { id: 're.landlord_tenant', parent: 're', label: 'Landlord & Tenant', domain: 're', level: 2 },
      { id: 're.landlord_tenant.rdsc', parent: 're.landlord_tenant', label: 'RDSC / Rental Disputes', domain: 're', level: 3 },
    { id: 're.construction', parent: 're', label: 'Construction Law', domain: 're', level: 2 },
      { id: 're.construction.fidic', parent: 're.construction', label: 'FIDIC Contracts', domain: 're', level: 3 },
      { id: 're.construction.disputes', parent: 're.construction', label: 'Construction Disputes', domain: 're', level: 3 },
      { id: 're.construction.delay_claims', parent: 're.construction', label: 'Delay & Disruption Claims', domain: 're', level: 3 },
    { id: 're.development', parent: 're', label: 'Property Development', domain: 're', level: 2 },
      { id: 're.development.jointventures', parent: 're.development', label: 'Development JVs', domain: 're', level: 3 },

  // ─── DOMAIN: Employment & Immigration ─────────────────────────────
  { id: 'em', label: 'Employment & Immigration', label_ar: 'العمل والهجرة', domain: 'em', level: 1 },
    { id: 'em.uae_labour', parent: 'em', label: 'UAE Labour Law (Federal Decree 33/2021)', domain: 'em', level: 2 },
      { id: 'em.uae_labour.contracts', parent: 'em.uae_labour', label: 'Employment Contracts', domain: 'em', level: 3 },
      { id: 'em.uae_labour.termination', parent: 'em.uae_labour', label: 'Termination & End-of-Service', domain: 'em', level: 3 },
      { id: 'em.uae_labour.disputes', parent: 'em.uae_labour', label: 'Labour Disputes & MOHRE', domain: 'em', level: 3 },
    { id: 'em.difc_employment', parent: 'em', label: 'DIFC Employment Law', domain: 'em', level: 2 },
    { id: 'em.adgm_employment', parent: 'em', label: 'ADGM Employment Regulations', domain: 'em', level: 2 },
    { id: 'em.immigration', parent: 'em', label: 'Immigration & Visas', domain: 'em', level: 2 },
      { id: 'em.immigration.golden_visa', parent: 'em.immigration', label: 'Golden Visa & Long-Term Residence', domain: 'em', level: 3 },
      { id: 'em.immigration.work_permits', parent: 'em.immigration', label: 'Work Permits & Sponsorship', domain: 'em', level: 3 },
    { id: 'em.emiratisation', parent: 'em', label: 'Emiratisation Compliance', domain: 'em', level: 2 },

  // ─── DOMAIN: IP & Technology ──────────────────────────────────────
  { id: 'ip', label: 'Intellectual Property & Technology', label_ar: 'الملكية الفكرية والتكنولوجيا', domain: 'ip', level: 1 },
    { id: 'ip.copyright', parent: 'ip', label: 'Copyright', domain: 'ip', level: 2 },
      { id: 'ip.copyright.uae', parent: 'ip.copyright', label: 'UAE Copyright Law', domain: 'ip', level: 3 },
      { id: 'ip.copyright.ai', parent: 'ip.copyright', label: 'AI & Copyright', domain: 'ip', level: 3 },
    { id: 'ip.trademarks', parent: 'ip', label: 'Trademarks', domain: 'ip', level: 2 },
      { id: 'ip.trademarks.uae', parent: 'ip.trademarks', label: 'UAE Trademark Registration', domain: 'ip', level: 3 },
      { id: 'ip.trademarks.gcc', parent: 'ip.trademarks', label: 'GCC Trademark System', domain: 'ip', level: 3 },
    { id: 'ip.patents', parent: 'ip', label: 'Patents', domain: 'ip', level: 2 },
    { id: 'ip.tech.data_protection', parent: 'ip', label: 'Data Protection & Privacy', domain: 'ip', level: 2 },
      { id: 'ip.tech.dp.uae_federal', parent: 'ip.tech.data_protection', label: 'UAE PDPL (Federal Decree 45/2021)', domain: 'ip', level: 3 },
      { id: 'ip.tech.dp.difc', parent: 'ip.tech.data_protection', label: 'DIFC Data Protection Law', domain: 'ip', level: 3 },
      { id: 'ip.tech.dp.adgm', parent: 'ip.tech.data_protection', label: 'ADGM Data Protection', domain: 'ip', level: 3 },
      { id: 'ip.tech.dp.gdpr', parent: 'ip.tech.data_protection', label: 'GDPR Compliance', domain: 'ip', level: 3 },
    { id: 'ip.tech.cybersecurity', parent: 'ip', label: 'Cybersecurity & Cybercrime', domain: 'ip', level: 2 },
    { id: 'ip.tech.ai_gov', parent: 'ip', label: 'AI Governance', domain: 'ip', level: 2 },
      { id: 'ip.tech.ai_gov.regulation', parent: 'ip.tech.ai_gov', label: 'AI Regulation (UAE & International)', domain: 'ip', level: 3 },
      { id: 'ip.tech.ai_gov.ethics', parent: 'ip.tech.ai_gov', label: 'AI Ethics & Professional Use', domain: 'ip', level: 3 },

  // ─── DOMAIN: Family & Personal Status ─────────────────────────────
  { id: 'fp', label: 'Family & Personal Status', label_ar: 'الأحوال الشخصية', domain: 'fp', level: 1 },
    { id: 'fp.muslim', parent: 'fp', label: 'Muslim Personal Status', domain: 'fp', level: 2 },
    { id: 'fp.non_muslim', parent: 'fp', label: 'Non-Muslim Personal Status (Federal Decree 41/2022)', domain: 'fp', level: 2 },
      { id: 'fp.non_muslim.adgm_civil', parent: 'fp.non_muslim', label: 'ADGM Civil Family Court', domain: 'fp', level: 3 },
    { id: 'fp.inheritance', parent: 'fp', label: 'Inheritance & Wills', domain: 'fp', level: 2 },
      { id: 'fp.inheritance.dubai_will', parent: 'fp.inheritance', label: 'Dubai Wills (DIFC / Abu Dhabi)', domain: 'fp', level: 3 },
    { id: 'fp.divorce', parent: 'fp', label: 'Divorce & Custody', domain: 'fp', level: 2 },

  // ─── DOMAIN: Criminal Law ─────────────────────────────────────────
  { id: 'cr', label: 'Criminal Law', label_ar: 'القانون الجنائي', domain: 'cr', level: 1 },
    { id: 'cr.procedure', parent: 'cr', label: 'Criminal Procedure', domain: 'cr', level: 2 },
    { id: 'cr.white_collar', parent: 'cr', label: 'White-Collar Crime', domain: 'cr', level: 2 },
      { id: 'cr.white_collar.fraud', parent: 'cr.white_collar', label: 'Commercial Fraud', domain: 'cr', level: 3 },
      { id: 'cr.white_collar.bribery', parent: 'cr.white_collar', label: 'Bribery & Corruption', domain: 'cr', level: 3 },
    { id: 'cr.cyber', parent: 'cr', label: 'Cybercrime', domain: 'cr', level: 2 },

  // ─── DOMAIN: Public & Administrative ──────────────────────────────
  { id: 'pa', label: 'Public & Administrative Law', label_ar: 'القانون الإداري', domain: 'pa', level: 1 },
    { id: 'pa.administrative', parent: 'pa', label: 'Administrative Decisions & Review', domain: 'pa', level: 2 },
    { id: 'pa.government_contracts', parent: 'pa', label: 'Government Contracts', domain: 'pa', level: 2 },
    { id: 'pa.constitutional', parent: 'pa', label: 'Constitutional Matters', domain: 'pa', level: 2 },

  // ─── DOMAIN: Tax & Customs ────────────────────────────────────────
  { id: 'tx', label: 'Tax & Customs', label_ar: 'الضرائب', domain: 'tx', level: 1 },
    { id: 'tx.corporate_tax', parent: 'tx', label: 'UAE Corporate Tax', domain: 'tx', level: 2 },
      { id: 'tx.corporate_tax.basics', parent: 'tx.corporate_tax', label: 'Corporate Tax Fundamentals', domain: 'tx', level: 3 },
      { id: 'tx.corporate_tax.qfzp', parent: 'tx.corporate_tax', label: 'Qualifying Free Zone Persons', domain: 'tx', level: 3 },
      { id: 'tx.corporate_tax.transfer_pricing', parent: 'tx.corporate_tax', label: 'Transfer Pricing', domain: 'tx', level: 3 },
    { id: 'tx.vat', parent: 'tx', label: 'VAT', domain: 'tx', level: 2 },
    { id: 'tx.excise', parent: 'tx', label: 'Excise Tax', domain: 'tx', level: 2 },
    { id: 'tx.customs', parent: 'tx', label: 'Customs & Trade', domain: 'tx', level: 2 },
    { id: 'tx.economic_substance', parent: 'tx', label: 'Economic Substance Regulations', domain: 'tx', level: 2 },

  // ─── DOMAIN: Energy & Infrastructure ──────────────────────────────
  { id: 'en', label: 'Energy, Resources & Infrastructure', label_ar: 'الطاقة والبنية التحتية', domain: 'en', level: 1 },
    { id: 'en.oil_gas', parent: 'en', label: 'Oil & Gas', domain: 'en', level: 2 },
    { id: 'en.renewables', parent: 'en', label: 'Renewables & Clean Energy', domain: 'en', level: 2 },
    { id: 'en.power', parent: 'en', label: 'Power & Utilities', domain: 'en', level: 2 },
    { id: 'en.ppp', parent: 'en', label: 'Public-Private Partnerships', domain: 'en', level: 2 },

  // ─── DOMAIN: Maritime & Aviation ──────────────────────────────────
  { id: 'ma', label: 'Maritime & Aviation', label_ar: 'البحري والطيران', domain: 'ma', level: 1 },
    { id: 'ma.shipping', parent: 'ma', label: 'Shipping & Maritime', domain: 'ma', level: 2 },
      { id: 'ma.shipping.commercial_maritime', parent: 'ma.shipping', label: 'UAE Commercial Maritime Law', domain: 'ma', level: 3 },
    { id: 'ma.aviation', parent: 'ma', label: 'Aviation', domain: 'ma', level: 2 },

  // ─── DOMAIN: Healthcare ───────────────────────────────────────────
  { id: 'hc', label: 'Healthcare & Life Sciences', label_ar: 'الرعاية الصحية', domain: 'hc', level: 1 },
    { id: 'hc.medical_negligence', parent: 'hc', label: 'Medical Negligence', domain: 'hc', level: 2 },
    { id: 'hc.licensing', parent: 'hc', label: 'Healthcare Licensing (DHA / DOH / MOHAP)', domain: 'hc', level: 2 },
    { id: 'hc.pharma', parent: 'hc', label: 'Pharmaceutical Regulation', domain: 'hc', level: 2 },

  // ─── DOMAIN: Insurance ────────────────────────────────────────────
  { id: 'in', label: 'Insurance', label_ar: 'التأمين', domain: 'in', level: 1 },
    { id: 'in.regulation', parent: 'in', label: 'Insurance Regulation (CB UAE)', domain: 'in', level: 2 },
    { id: 'in.coverage_disputes', parent: 'in', label: 'Coverage Disputes', domain: 'in', level: 2 },

  // ─── DOMAIN: Regulatory Compliance & Ethics ───────────────────────
  { id: 'rc', label: 'Regulatory Compliance & Ethics', label_ar: 'الامتثال والأخلاقيات', domain: 'rc', level: 1 },
    { id: 'rc.ethics', parent: 'rc', label: 'Professional Ethics & Conduct', domain: 'rc', level: 2 },
      { id: 'rc.ethics.uae_code', parent: 'rc.ethics', label: 'UAE Code of Ethics for Legal Professionals', domain: 'rc', level: 3 },
      { id: 'rc.ethics.conflicts', parent: 'rc.ethics', label: 'Conflicts of Interest', domain: 'rc', level: 3 },
      { id: 'rc.ethics.confidentiality', parent: 'rc.ethics', label: 'Client Confidentiality', domain: 'rc', level: 3 },
    { id: 'rc.uae_legal_framework', parent: 'rc', label: 'UAE Legal Framework', domain: 'rc', level: 2 },
      { id: 'rc.uae_legal_framework.constitution', parent: 'rc.uae_legal_framework', label: 'UAE Constitution & Federal Structure', domain: 'rc', level: 3 },
      { id: 'rc.uae_legal_framework.sources', parent: 'rc.uae_legal_framework', label: 'Sources of UAE Law (Sharia, Civil Code, Federal)', domain: 'rc', level: 3 },
    { id: 'rc.esg', parent: 'rc', label: 'ESG & Sustainability', domain: 'rc', level: 2 },
      { id: 'rc.esg.climate', parent: 'rc.esg', label: 'Climate Law & COP28 Outcomes', domain: 'rc', level: 3 },
      { id: 'rc.esg.reporting', parent: 'rc.esg', label: 'ESG Reporting & Disclosure', domain: 'rc', level: 3 },
    { id: 'rc.tax_updates', parent: 'rc', label: 'Regulatory Updates', domain: 'rc', level: 2 },
      { id: 'rc.tax_updates.tax', parent: 'rc.tax_updates', label: 'Tax Law Updates', domain: 'rc', level: 3 },

  // ─── DOMAIN: UAE Jurisdictions ────────────────────────────────────
  { id: 'jx', label: 'UAE Jurisdictional Specialisms', label_ar: 'التخصصات القضائية', domain: 'jx', level: 1 },
    { id: 'jx.civil_transactions', parent: 'jx', label: 'UAE Civil Transactions Law', domain: 'jx', level: 2 },
    { id: 'jx.difc', parent: 'jx', label: 'DIFC Practice', domain: 'jx', level: 2 },
      { id: 'jx.difc.courts', parent: 'jx.difc', label: 'DIFC Courts Practice', domain: 'jx', level: 3 },
    { id: 'jx.adgm', parent: 'jx', label: 'ADGM Practice', domain: 'jx', level: 2 },
      { id: 'jx.adgm.courts', parent: 'jx.adgm', label: 'ADGM Courts Practice', domain: 'jx', level: 3 },
    { id: 'jx.sharia', parent: 'jx', label: 'Sharia Commercial Application', domain: 'jx', level: 2 },

  // ─── DOMAIN: Professional Skills ──────────────────────────────────
  { id: 'ps', label: 'Professional Skills', label_ar: 'المهارات المهنية', domain: 'ps', level: 1 },
    { id: 'ps.advocacy', parent: 'ps', label: 'Advocacy & Oral Skills', domain: 'ps', level: 2 },
    { id: 'ps.drafting', parent: 'ps', label: 'Legal Drafting', domain: 'ps', level: 2 },
    { id: 'ps.negotiation', parent: 'ps', label: 'Negotiation', domain: 'ps', level: 2 },
    { id: 'ps.legal_tech', parent: 'ps', label: 'Legal Technology', domain: 'ps', level: 2 },
      { id: 'ps.legal_tech.ai_tools', parent: 'ps.legal_tech', label: 'AI Tools for Legal Practice', domain: 'ps', level: 3 },
    { id: 'ps.client_care', parent: 'ps', label: 'Client Care & Practice Management', domain: 'ps', level: 2 },

  // ─── DOMAIN: Emerging Areas ───────────────────────────────────────
  { id: 'eg', label: 'Emerging Areas', label_ar: 'المجالات الناشئة', domain: 'eg', level: 1 },
    { id: 'eg.space', parent: 'eg', label: 'Space Law', domain: 'eg', level: 2 },
    { id: 'eg.metaverse', parent: 'eg', label: 'Metaverse & Virtual Worlds', domain: 'eg', level: 2 },
    { id: 'eg.climate_litigation', parent: 'eg', label: 'Climate Change Litigation', domain: 'eg', level: 2 },
];
