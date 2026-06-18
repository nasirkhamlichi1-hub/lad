-- 014-test-logins.sql
-- Enable a handful of working test logins on top of the loaded dataset so the
-- platform can be exercised end-to-end. All use password: test
-- (bcrypt hash reused from 009). Emails are memorable @clpd.test addresses.

-- ── Lawyer logins (across six different firms) ──
-- password: test
UPDATE lawyers SET email='lawyer.allenovery@clpd.test',     password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE id='L-06818';
UPDATE lawyers SET email='lawyer.clyde@clpd.test',          password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE id='L-05010';
UPDATE lawyers SET email='lawyer.altamimi@clpd.test',       password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE id='L-01253';
UPDATE lawyers SET email='lawyer.dlapiper@clpd.test',       password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE id='L-06548';
UPDATE lawyers SET email='lawyer.whitecase@clpd.test',      password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE id='L-00235';
UPDATE lawyers SET email='lawyer.cliffordchance@clpd.test', password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE id='L-04231';

-- ── Firm compliance-officer logins (four firms) ──
-- password: test
INSERT OR IGNORE INTO staff (id, email, first_name, last_name, role, firm_id, provider_id, status, password_hash, must_change_password) VALUES
  ('S-CO-AO',   'co.allenovery@clpd.test',     'Allen & Overy',  'Compliance Officer', 'firm_compliance_officer', 'allen-overy-shearman-sterling-llp',              NULL, 'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0),
  ('S-CO-CLYDE','co.clyde@clpd.test',          'Clyde & Co',     'Compliance Officer', 'firm_compliance_officer', 'clyde-co-llp',                                   NULL, 'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0),
  ('S-CO-TAMIMI','co.altamimi@clpd.test',      'Al Tamimi',      'Compliance Officer', 'firm_compliance_officer', 'al-tamimi-company-advocates-legal-consultants',  NULL, 'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0),
  ('S-CO-DLA',  'co.dlapiper@clpd.test',       'DLA Piper',      'Compliance Officer', 'firm_compliance_officer', 'dla-piper-middle-east-llp',                      NULL, 'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0);

-- ── Ensure the super-admin (nasir) is active with all-tabs access ──
-- (Role gating for lad_super_admin is enforced in middleware; this just
-- guarantees the account is active. Password unchanged from 009: test)
UPDATE staff SET role='lad_super_admin', status='active' WHERE LOWER(email)='nasir.khamlichi@legal.dubai.gov.ae';
