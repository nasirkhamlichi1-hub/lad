-- Assignment: who put this topic in front of this lawyer, and why.
--
-- Publishing a topic makes it reachable; it does not put it in front of
-- anyone. An assignment is an enrolment created by the Department (or by a
-- firm's compliance officer for their own lawyers) rather than by the learner,
-- so the record needs to say who did it, when it is due, and any note that
-- went with it. source = 'assigned' on the enrolment row marks the case; the
-- columns below carry the detail. Nothing about progress changes — progress
-- is still derived from attempts only.
ALTER TABLE enrolment ADD COLUMN assigned_by TEXT;
ALTER TABLE enrolment ADD COLUMN assigned_by_name TEXT;
ALTER TABLE enrolment ADD COLUMN assigned_at TEXT;
ALTER TABLE enrolment ADD COLUMN due_at TEXT;
ALTER TABLE enrolment ADD COLUMN note TEXT;
