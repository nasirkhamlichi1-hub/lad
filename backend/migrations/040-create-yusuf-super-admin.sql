-- 040-create-yusuf-super-admin.sql
-- Test super-user account requested for customer testing.
-- NOTE: password is the literal word "test" (weak — change/remove before real
-- go-live; self-service reset works, or delete this row). Idempotent.
INSERT OR IGNORE INTO staff (id, email, first_name, last_name, role, status, password_hash, must_change_password)
VALUES (
  'staff-yusuf-creativeword',
  'yusuf@creativeword.ae',
  'Yusuf', '',
  'lad_super_admin', 'active',
  '$2a$12$O037dqi4bnE/RuNvuZUi4uU6QdRmWidXwRUWhEmajinoFQgRyTiq2',
  0
);
