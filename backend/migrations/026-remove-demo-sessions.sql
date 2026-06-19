-- Remove the demo course sessions seeded by 011 (fabricated May/June 2026 dates
-- like '28 May' on intl-arbitration / aml-update). The real schedule is loaded
-- by 015. Targets only the specific demo session ids (suffix '#N'); 015's real
-- sessions are untouched.

-- Delete ONLY the fabricated demo sessions. The courses themselves
-- (aml-update, construction, mediation) are real and have real feedback — they
-- stay active and simply show no scheduled session until a real one is added.
DELETE FROM course_sessions WHERE id IN (
  'aml-update#0','aml-update#1','aml-update#2','aml-update#3',
  'construction#0','construction#1','construction#2',
  'intl-arbitration#0','intl-arbitration#1',
  'mediation#0','mediation#1'
);
