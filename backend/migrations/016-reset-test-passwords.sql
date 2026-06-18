-- 016-reset-test-passwords.sql
-- Force every test/demo login back to password: test
-- (009 used INSERT OR IGNORE, so any account whose password was changed in a
-- prior session kept the changed hash and no longer matched 'test'.)
-- Hash below is bcrypt('test'). UPDATE overwrites whatever is there.

-- Staff (super-admin, LAD admin, firm COs, provider)
UPDATE staff SET password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active'
WHERE LOWER(email) IN (
  'nasir.khamlichi@legal.dubai.gov.ae',
  'ladadmin@lad.com',
  'galadari@galadari.com',
  'training@train.com',
  'co.allenovery@clpd.test',
  'co.clyde@clpd.test',
  'co.altamimi@clpd.test',
  'co.dlapiper@clpd.test'
);

-- Lawyers (demo + the six test logins)
UPDATE lawyers SET password_hash='$2a$10$iru1Hhei4RHXEUgH4fY8a.V.kNRfT9EN5ULlLXVceG3I6pJVn8Dr2', must_change_password=0, status='active'
WHERE id IN ('L-DEMO-GAL','L-06818','L-05010','L-01253','L-06548','L-00235','L-04231');
