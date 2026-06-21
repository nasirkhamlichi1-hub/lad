-- 037-areas-of-practice-taxonomy.sql
-- Replace the placeholder skills taxonomy with the official Dubai Areas of
-- Practice. course_topics is empty pre-go-live, so this is non-destructive.
--
-- Model: each Area = a domain (level 1); each sub-area = a taggable topic
-- (level 2), shown in the Smart Tags dropdown as "Area › Topic" and used by the
-- AI auto-tagger (which reads active level-2 topics from this table). Standalone
-- areas get a single same-named topic so they remain taggable.

-- Retire the old placeholder vocabulary (kept inactive, not deleted, so nothing
-- references a missing id). Idempotent: targets only the old domain slugs.
UPDATE taxonomies SET active = 0
  WHERE domain IN ('dr','corp','fin','reg','rec','emp','tech','skill');

INSERT OR IGNORE INTO taxonomies (id, parent_id, label, domain, level, display_order, active) VALUES
  -- 1. Family / Personal Status
  ('fam', NULL, 'Family & Personal Status', 'fam', 1, 100, 1),
  ('fam.marriage-divorce', 'fam', 'Marriage & Divorce', 'fam', 2, 101, 1),
  ('fam.custody-alimony', 'fam', 'Custody & Alimony', 'fam', 2, 102, 1),
  ('fam.capacity-guardianship', 'fam', 'Legal Capacity & Guardianship', 'fam', 2, 103, 1),

  -- 2. Civil Transactions
  ('civil', NULL, 'Civil Transactions', 'civil', 1, 200, 1),
  ('civil.sale', 'civil', 'Sale', 'civil', 2, 201, 1),
  ('civil.tenancy', 'civil', 'Tenancy', 'civil', 2, 202, 1),
  ('civil.compensation', 'civil', 'Compensation', 'civil', 2, 203, 1),
  ('civil.poa-sponsorship', 'civil', 'POA & Sponsorship', 'civil', 2, 204, 1),
  ('civil.ownership-title', 'civil', 'Ownership & Title', 'civil', 2, 205, 1),

  -- 3. Commercial Transactions
  ('commercial', NULL, 'Commercial Transactions', 'commercial', 1, 300, 1),
  ('commercial.negotiable', 'commercial', 'Bills of Exchange, Cheques & Promissory Notes', 'commercial', 2, 301, 1),
  ('commercial.contracts', 'commercial', 'Commercial Contracts', 'commercial', 2, 302, 1),
  ('commercial.agency', 'commercial', 'Commercial Agency', 'commercial', 2, 303, 1),
  ('commercial.mortgage', 'commercial', 'Commercial Mortgage', 'commercial', 2, 304, 1),
  ('commercial.ecommerce', 'commercial', 'E-Commerce', 'commercial', 2, 305, 1),

  -- 4. Criminal Law
  ('criminal', NULL, 'Criminal Law', 'criminal', 1, 400, 1),
  ('criminal.persons', 'criminal', 'Crimes Against Persons', 'criminal', 2, 401, 1),
  ('criminal.property', 'criminal', 'Crimes Against Property', 'criminal', 2, 402, 1),
  ('criminal.cyber', 'criminal', 'Cybercrimes', 'criminal', 2, 403, 1),
  ('criminal.hate', 'criminal', 'Hate Crimes', 'criminal', 2, 404, 1),
  ('criminal.family', 'criminal', 'Family Crimes', 'criminal', 2, 405, 1),
  ('criminal.defamation', 'criminal', 'Defamation Crimes', 'criminal', 2, 406, 1),
  ('criminal.drug', 'criminal', 'Drug Crimes', 'criminal', 2, 407, 1),
  ('criminal.terrorism', 'criminal', 'Terrorism', 'criminal', 2, 408, 1),
  ('criminal.child-abuse', 'criminal', 'Child Abuse & Abduction', 'criminal', 2, 409, 1),

  -- 5. Proceedings
  ('proceedings', NULL, 'Proceedings', 'proceedings', 1, 500, 1),
  ('proceedings.civil-dubai', 'proceedings', 'Civil Cases & Proceedings — Dubai Courts', 'proceedings', 2, 501, 1),
  ('proceedings.criminal-dubai', 'proceedings', 'Criminal Cases & Proceedings — Dubai Courts', 'proceedings', 2, 502, 1),
  ('proceedings.difc', 'proceedings', 'Cases & Proceedings — DIFC Courts', 'proceedings', 2, 503, 1),
  ('proceedings.rdc', 'proceedings', 'Cases & Proceedings — Rental Dispute Resolution Centre', 'proceedings', 2, 504, 1),
  ('proceedings.arbitral-adr', 'proceedings', 'Arbitral Tribunals & Other ADR Bodies', 'proceedings', 2, 505, 1),

  -- 6. Employment
  ('employment', NULL, 'Employment', 'employment', 1, 600, 1),
  ('employment.hr', 'employment', 'HR & Employee Affairs', 'employment', 2, 601, 1),
  ('employment.labor', 'employment', 'Labor & Workers', 'employment', 2, 602, 1),
  ('employment.compensation', 'employment', 'Compensation', 'employment', 2, 603, 1),

  -- 7. Intellectual Property
  ('ip', NULL, 'Intellectual Property', 'ip', 1, 700, 1),
  ('ip.trademarks', 'ip', 'Trademarks', 'ip', 2, 701, 1),
  ('ip.copyright', 'ip', 'Copyright & Related Rights', 'ip', 2, 702, 1),
  ('ip.patents', 'ip', 'Patents', 'ip', 2, 703, 1),
  ('ip.trade-secrets', 'ip', 'Trade Secrets', 'ip', 2, 704, 1),

  -- 8. Immigration & Residency (standalone)
  ('immigration', NULL, 'Immigration & Residency', 'immigration', 1, 800, 1),
  ('immigration.general', 'immigration', 'Immigration & Residency', 'immigration', 2, 801, 1),

  -- 9. Inheritance & Wills
  ('inheritance', NULL, 'Inheritance & Wills', 'inheritance', 1, 900, 1),
  ('inheritance.legacies', 'inheritance', 'Legacies & Inheritance', 'inheritance', 2, 901, 1),
  ('inheritance.wills', 'inheritance', 'Wills', 'inheritance', 2, 902, 1),

  -- 10. Transportation & Logistics
  ('transport', NULL, 'Transportation & Logistics', 'transport', 1, 1000, 1),
  ('transport.cargo', 'transport', 'Cargo', 'transport', 2, 1001, 1),
  ('transport.aviation', 'transport', 'Aviation', 'transport', 2, 1002, 1),
  ('transport.carriage-persons', 'transport', 'Carriage of Persons', 'transport', 2, 1003, 1),
  ('transport.air-freight', 'transport', 'Air Freight', 'transport', 2, 1004, 1),
  ('transport.aviation-space', 'transport', 'Aviation & Space Law', 'transport', 2, 1005, 1),
  ('transport.aviation-finance', 'transport', 'Aviation Finance', 'transport', 2, 1006, 1),

  -- 11. Maritime
  ('maritime', NULL, 'Maritime', 'maritime', 1, 1100, 1),
  ('maritime.carriage-persons', 'maritime', 'Carriage of Persons', 'maritime', 2, 1101, 1),
  ('maritime.sea-freight', 'maritime', 'Sea Freight', 'maritime', 2, 1102, 1),
  ('maritime.finance', 'maritime', 'Maritime Finance', 'maritime', 2, 1103, 1),

  -- 12. Corporate Law
  ('corporate', NULL, 'Corporate Law', 'corporate', 1, 1200, 1),
  ('corporate.finance', 'corporate', 'Corporate Finance', 'corporate', 2, 1201, 1),
  ('corporate.ma', 'corporate', 'Merger & Acquisition', 'corporate', 2, 1202, 1),
  ('corporate.jv', 'corporate', 'Joint Ventures', 'corporate', 2, 1203, 1),
  ('corporate.governance', 'corporate', 'Corporate Governance', 'corporate', 2, 1204, 1),

  -- 13. Banking & Finance
  ('banking', NULL, 'Banking & Finance', 'banking', 1, 1300, 1),
  ('banking.restructuring', 'banking', 'Financial Restructuring', 'banking', 2, 1301, 1),
  ('banking.islamic', 'banking', 'Islamic Finance', 'banking', 2, 1302, 1),

  -- 14. Anti-Trust / Competition (standalone)
  ('competition', NULL, 'Anti-Trust / Competition', 'competition', 1, 1400, 1),
  ('competition.general', 'competition', 'Anti-Trust / Competition', 'competition', 2, 1401, 1),

  -- 15. Consumer Protection (standalone)
  ('consumer', NULL, 'Consumer Protection', 'consumer', 1, 1500, 1),
  ('consumer.general', 'consumer', 'Consumer Protection', 'consumer', 2, 1501, 1),

  -- 16. Construction & Service Contracts
  ('construction', NULL, 'Construction & Service Contracts', 'construction', 1, 1600, 1),
  ('construction.construction', 'construction', 'Construction', 'construction', 2, 1601, 1),
  ('construction.fidic', 'construction', 'FIDIC Contracts', 'construction', 2, 1602, 1),
  ('construction.service', 'construction', 'Service Contracts', 'construction', 2, 1603, 1),

  -- 17. Insurance (standalone)
  ('insurance', NULL, 'Insurance', 'insurance', 1, 1700, 1),
  ('insurance.general', 'insurance', 'Insurance', 'insurance', 2, 1701, 1),

  -- 18. Arbitration
  ('arbitration', NULL, 'Arbitration', 'arbitration', 1, 1800, 1),
  ('arbitration.commercial', 'arbitration', 'Commercial Arbitration', 'arbitration', 2, 1801, 1),
  ('arbitration.construction', 'arbitration', 'Construction Arbitration', 'arbitration', 2, 1802, 1),
  ('arbitration.investor-state', 'arbitration', 'Investor-State Arbitration', 'arbitration', 2, 1803, 1),

  -- 19. Medical & Life Sciences
  ('medical', NULL, 'Medical & Life Sciences', 'medical', 1, 1900, 1),
  ('medical.negligence', 'medical', 'Medical Negligence', 'medical', 2, 1901, 1),
  ('medical.pharma', 'medical', 'Pharmaceutical', 'medical', 2, 1902, 1),
  ('medical.biotech', 'medical', 'Bio Tech', 'medical', 2, 1903, 1),

  -- 20. Human Rights
  ('human-rights', NULL, 'Human Rights', 'human-rights', 1, 2000, 1),
  ('human-rights.general', 'human-rights', 'Human Rights', 'human-rights', 2, 2001, 1),
  ('human-rights.women', 'human-rights', 'Women''s Rights', 'human-rights', 2, 2002, 1),
  ('human-rights.children', 'human-rights', 'Children''s Rights', 'human-rights', 2, 2003, 1),

  -- 21. Environment Law (standalone)
  ('environment', NULL, 'Environment Law', 'environment', 1, 2100, 1),
  ('environment.general', 'environment', 'Environment Law', 'environment', 2, 2101, 1),

  -- 22. Family Businesses
  ('family-business', NULL, 'Family Businesses', 'family-business', 1, 2200, 1),
  ('family-business.general', 'family-business', 'Family Businesses', 'family-business', 2, 2201, 1),
  ('family-business.waqf', 'family-business', 'Family Waqf', 'family-business', 2, 2202, 1),
  ('family-business.trust', 'family-business', 'Trust', 'family-business', 2, 2203, 1),

  -- 23. Financial Crime
  ('financial-crime', NULL, 'Financial Crime', 'financial-crime', 1, 2300, 1),
  ('financial-crime.money-laundering', 'financial-crime', 'Money Laundering', 'financial-crime', 2, 2301, 1),
  ('financial-crime.terrorism', 'financial-crime', 'Terrorism Financing', 'financial-crime', 2, 2302, 1),

  -- 24. Sports Law & Entertainment (standalone)
  ('sports-entertainment', NULL, 'Sports Law & Entertainment', 'sports-entertainment', 1, 2400, 1),
  ('sports-entertainment.general', 'sports-entertainment', 'Sports Law & Entertainment', 'sports-entertainment', 2, 2401, 1),

  -- 25. Media Law (standalone)
  ('media', NULL, 'Media Law', 'media', 1, 2500, 1),
  ('media.general', 'media', 'Media Law', 'media', 2, 2501, 1),

  -- 26. Constitutional & Administrative Law (standalone)
  ('constitutional', NULL, 'Constitutional & Administrative Law', 'constitutional', 1, 2600, 1),
  ('constitutional.general', 'constitutional', 'Constitutional & Administrative Law', 'constitutional', 2, 2601, 1),

  -- 27. Tax (standalone)
  ('tax', NULL, 'Tax', 'tax', 1, 2700, 1),
  ('tax.general', 'tax', 'Tax', 'tax', 2, 2701, 1),

  -- 28. Charity Law (standalone)
  ('charity', NULL, 'Charity Law', 'charity', 1, 2800, 1),
  ('charity.general', 'charity', 'Charity Law', 'charity', 2, 2801, 1),

  -- 29. Alternative Dispute Resolution (standalone)
  ('adr', NULL, 'Alternative Dispute Resolution (ADR)', 'adr', 1, 2900, 1),
  ('adr.general', 'adr', 'Alternative Dispute Resolution (ADR)', 'adr', 2, 2901, 1),

  -- 30. Animal Law (standalone)
  ('animal', NULL, 'Animal Law', 'animal', 1, 3000, 1),
  ('animal.general', 'animal', 'Animal Law', 'animal', 2, 3001, 1),

  -- 31. Real Estate
  ('real-estate', NULL, 'Real Estate', 'real-estate', 1, 3100, 1),
  ('real-estate.sale', 'real-estate', 'Sale of Real Estate', 'real-estate', 2, 3101, 1),
  ('real-estate.tenancy', 'real-estate', 'Tenancy / Lease of Real Estate', 'real-estate', 2, 3102, 1),
  ('real-estate.commercial', 'real-estate', 'Commercial Real Estate', 'real-estate', 2, 3103, 1),
  ('real-estate.residential', 'real-estate', 'Residential Real Estate', 'real-estate', 2, 3104, 1),
  ('real-estate.ownership', 'real-estate', 'Ownership & Titles', 'real-estate', 2, 3105, 1),
  ('real-estate.mortgage', 'real-estate', 'Commercial Mortgage', 'real-estate', 2, 3106, 1),

  -- 32. IT & Technology
  ('it-tech', NULL, 'IT & Technology', 'it-tech', 1, 3200, 1),
  ('it-tech.crypto-fintech', 'it-tech', 'Cryptocurrencies & Fintech', 'it-tech', 2, 3201, 1),
  ('it-tech.data-protection', 'it-tech', 'Data Protection', 'it-tech', 2, 3202, 1),
  ('it-tech.cybersecurity', 'it-tech', 'Cybersecurity', 'it-tech', 2, 3203, 1),
  ('it-tech.blockchain', 'it-tech', 'Blockchain', 'it-tech', 2, 3204, 1),
  ('it-tech.nfc', 'it-tech', 'NFC / NFT', 'it-tech', 2, 3205, 1),

  -- 33. Investment
  ('investment', NULL, 'Investment', 'investment', 1, 3300, 1),
  ('investment.securities', 'investment', 'Securities Exchange Market', 'investment', 2, 3301, 1),
  ('investment.funds', 'investment', 'Investment Funds', 'investment', 2, 3302, 1),

  -- 34. Energy & Natural Resources (standalone)
  ('energy', NULL, 'Energy & Natural Resources', 'energy', 1, 3400, 1),
  ('energy.general', 'energy', 'Energy & Natural Resources', 'energy', 2, 3401, 1),

  -- 35. Bankruptcy & Restructuring
  ('bankruptcy', NULL, 'Bankruptcy & Restructuring', 'bankruptcy', 1, 3500, 1),
  ('bankruptcy.restructuring', 'bankruptcy', 'Restructuring', 'bankruptcy', 2, 3501, 1),
  ('bankruptcy.bankruptcy', 'bankruptcy', 'Bankruptcy', 'bankruptcy', 2, 3502, 1),
  ('bankruptcy.liquidation', 'bankruptcy', 'Liquidation', 'bankruptcy', 2, 3503, 1),
  ('bankruptcy.administration', 'bankruptcy', 'Administration', 'bankruptcy', 2, 3504, 1);
