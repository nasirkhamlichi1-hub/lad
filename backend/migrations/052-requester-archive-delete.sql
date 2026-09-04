-- ─────────────────────────────────────────────────────────────────────
-- 052 — Lawyers and firms can archive and delete their own conversations
-- ─────────────────────────────────────────────────────────────────────
-- Migration 041 gave CLPD admins an archive flag so a settled thread drops
-- out of the working inbox. That flag is the admin team's, and it must stay
-- theirs: a lawyer tidying their own message list must not be able to make
-- a thread vanish from the Department's queue, and an admin archiving a
-- thread must not hide it from the person who raised it.
--
-- So the requester side gets its own two switches.
--
--   requester_archived     the requester has moved the thread out of their
--                          inbox into their own "Archived" view. A new reply
--                          from CLPD clears it, so an answer is never missed.
--
--   requester_deleted_at   the requester has deleted the thread. It leaves
--                          their account for good — list, thread and badge.
--                          The row itself stays: correspondence with a
--                          regulator is a record, and the Department keeps
--                          its copy. Admins see it marked as deleted by the
--                          requester rather than seeing it disappear.
ALTER TABLE conversations ADD COLUMN requester_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN requester_archived_at TEXT;
ALTER TABLE conversations ADD COLUMN requester_deleted_at TEXT;
