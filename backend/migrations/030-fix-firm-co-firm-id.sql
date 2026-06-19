-- 030-fix-firm-co-firm-id.sql
-- Two firm compliance-officer accounts were created with a NULL firm_id (their
-- rows pre-existed, so migration 014's INSERT OR IGNORE never set it). Without a
-- firm_id, every firm-scoped call (lawyers, credits, bookings) falls back to a
-- placeholder and returns nothing. Point them at their real firm — the one that
-- actually holds their lawyers. Matched by email so it works whatever the row id.
UPDATE staff SET firm_id = 'allen-overy-shearman-sterling-llp'
  WHERE LOWER(email) = 'co.allenovery@clpd.test' AND (firm_id IS NULL OR firm_id = '');
UPDATE staff SET firm_id = 'dla-piper-middle-east-llp'
  WHERE LOWER(email) = 'co.dlapiper@clpd.test' AND (firm_id IS NULL OR firm_id = '');
