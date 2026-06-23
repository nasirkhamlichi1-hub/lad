-- Distinguish "mandatory ethics" courses from other mandatory courses so
-- reporting and compliance can track ethics separately (it is a mandatory
-- sub-requirement). A flag on top of the existing type='mandatory'.
ALTER TABLE courses ADD COLUMN is_ethics INTEGER DEFAULT 0;
-- Seed: existing mandatory courses whose title mentions ethics are ethics courses.
UPDATE courses SET is_ethics = 1
  WHERE COALESCE(type,'') = 'mandatory' AND LOWER(title) LIKE '%ethic%';
