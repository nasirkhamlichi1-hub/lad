-- Private accredited courses. Each accredited course is PRIVATE to its provider
-- firm (visible only to that firm and the LAD backend) unless the provider is
-- DIFC Academy or Kwintessential (public). Mandatory courses are unaffected and
-- always public. A firm's own lawyers can see and book that firm's private
-- courses. Loaded from seed-data/accredited-courses.json by seed-accredited.js.

ALTER TABLE courses ADD COLUMN private INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN owner_firm_id TEXT;
ALTER TABLE courses ADD COLUMN accredited_provider TEXT;

CREATE INDEX IF NOT EXISTS idx_courses_private ON courses (private);
CREATE INDEX IF NOT EXISTS idx_courses_owner_firm ON courses (owner_firm_id);
