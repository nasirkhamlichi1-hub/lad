-- 018-staff-admin-logins.sql
-- Two more working test logins for the people who run the programme:
--   • CLPD Admin  — administers the CLPD programme (lad-admin / /admin)
--   • LAD Staff   — LAD service-staff oversight + internal staff training
-- Both use password: test  (bcrypt hash reused from 009/014).

INSERT OR IGNORE INTO staff (id, email, first_name, last_name, role, firm_id, provider_id, status, password_hash, must_change_password) VALUES
  ('S-CLPD-ADMIN', 'admin.clpd@legal.dubai.gov.ae', 'Aisha', 'Al Falasi', 'lad_admin',        NULL, NULL, 'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0),
  ('S-LAD-STAFF',  'staff.lad@legal.dubai.gov.ae',  'Sara',  'Hashimi',   'lad_intelligence', NULL, NULL, 'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0);

-- Force the role/password/status even if the rows already existed from an
-- earlier run, so these logins always work with password: test.
UPDATE staff SET role='lad_admin',        password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE LOWER(email)='admin.clpd@legal.dubai.gov.ae';
UPDATE staff SET role='lad_intelligence', password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE LOWER(email)='staff.lad@legal.dubai.gov.ae';
