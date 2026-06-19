-- Remove the seeded demo accreditation records (ALL2690–ALL2693, "Cross-Border
-- M&A Masterclass" etc.) introduced by 017 to demo the attendance-alert flow.
-- They are not real applications and were surfacing in the copilot, the
-- accreditation review queue and the attendance-filing alerts.

DELETE FROM accreditations
 WHERE accreditation_code IN ('ALL2690','ALL2691','ALL2692','ALL2693')
    OR ref IN ('ALL2690','ALL2691','ALL2692','ALL2693');

DELETE FROM attendance_alert_log
 WHERE ref IN ('ALL2690','ALL2691','ALL2692','ALL2693');
