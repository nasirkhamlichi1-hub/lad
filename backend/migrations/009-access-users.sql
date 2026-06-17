-- ─────────────────────────────────────────────────────────────────────
-- 009 — Access accounts for each UI journey (password auth)
-- ─────────────────────────────────────────────────────────────────────
-- Six sign-in accounts so every role/portal can be walked end to end.
-- Shared password: "test"  (bcrypt hash below; must_change_password = 0).
-- Idempotent: INSERT OR IGNORE keyed on the fixed primary keys.
--
--   galadari@galadari.com                  Firm (compliance officer)
--   lawyer@galadari.com                    Lawyer
--   Ladstaff@lad.com                       LAD Staff Training (trainee)
--   Ladadmin@lad.com                       LAD Admin
--   Training@train.com                     Training provider
--   nasir.khamlichi@legal.dubai.gov.ae     Super user (all access)

PRAGMA foreign_keys = ON;

-- Reference org rows the accounts hang off.
INSERT OR IGNORE INTO firms (id, name, full_name, status)
  VALUES ('galadari', 'Galadari Advocates', 'Galadari Advocates', 'practising');
INSERT OR IGNORE INTO providers (id, name, full_name, accredited)
  VALUES ('trainco', 'Training Firm', 'Training Firm (Accredited Provider)', 1);

-- Staff accounts (firm CO, LAD staff training, LAD admin, provider, super).
INSERT OR IGNORE INTO staff (id, email, first_name, last_name, role, firm_id, provider_id, status, password_hash, must_change_password)
VALUES
  ('S-FIRM-GAL',   'galadari@galadari.com',               'Galadari', 'Compliance',  'firm_compliance_officer', 'galadari', NULL,      'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0),
  ('S-LADSTAFF',   'Ladstaff@lad.com',                    'LAD',      'Trainee',     'lad_staff_training',      NULL,       NULL,      'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0),
  ('S-LADADMIN',   'Ladadmin@lad.com',                    'LAD',      'Admin',       'lad_admin',               NULL,       NULL,      'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0),
  ('S-PROV-TRAIN', 'Training@train.com',                  'Training', 'Firm',        'provider_admin',          NULL,       'trainco', 'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0),
  ('S-SUPER',      'nasir.khamlichi@legal.dubai.gov.ae',  'Nasir',    'Khamlichi',   'lad_super_admin',         NULL,       NULL,      'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0);

-- Lawyer account.
INSERT OR IGNORE INTO lawyers (id, email, first_name, last_name, firm_id, role, status, credit_balance, lifetime_points, password_hash, must_change_password)
VALUES
  ('L-DEMO-GAL', 'lawyer@galadari.com', 'Demo', 'Lawyer', 'galadari', 'Associate', 'active', 10, 0, '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0);
