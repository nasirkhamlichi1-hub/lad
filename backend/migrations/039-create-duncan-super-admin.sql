-- 039-create-duncan-super-admin.sql
-- Test super-admin account requested for customer testing.
-- NOTE: the password is the literal word "test" (bcrypt hash below). This is a
-- weak credential for a super-admin — change or remove it before real go-live
-- (self-service reset now works, or delete this row). Idempotent: INSERT OR IGNORE.
INSERT OR IGNORE INTO staff (id, email, first_name, last_name, role, status, password_hash, must_change_password)
VALUES (
  'staff-duncan-wood',
  'duncan.wood@legal.dubai.gov.ae',
  'Duncan', 'Wood',
  'lad_super_admin', 'active',
  '$2a$12$O037dqi4bnE/RuNvuZUi4uU6QdRmWidXwRUWhEmajinoFQgRyTiq2',
  0
);
