-- 019-lad-staff-training.sql
-- Correct the LAD role model:
--   • LAD Super Users (nasir, Duncan Wood) — full access to everything.
--   • LAD Staff (staff.lad) — NO oversight/intelligence; internal training only.
-- All test accounts use password: test (bcrypt hash reused from 009/014).

-- LAD Super Users — can access any site and do all things.
UPDATE staff SET role='lad_super_admin', status='active' WHERE LOWER(email)='nasir.khamlichi@legal.dubai.gov.ae';

INSERT OR IGNORE INTO staff (id, email, first_name, last_name, role, firm_id, provider_id, status, password_hash, must_change_password) VALUES
  ('S-SU-DUNCAN', 'duncan.wood@legal.dubai.gov.ae', 'Duncan', 'Wood', 'lad_super_admin', NULL, NULL, 'active', '$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', 0);
UPDATE staff SET role='lad_super_admin', password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active' WHERE LOWER(email)='duncan.wood@legal.dubai.gov.ae';

-- LAD Staff — internal training role only (routes to /staff-training).
UPDATE staff SET role='lad_staff', status='active' WHERE LOWER(email)='staff.lad@legal.dubai.gov.ae';
