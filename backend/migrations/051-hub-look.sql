-- ─────────────────────────────────────────────────────────────────────
-- 051 — Every hub can look like its own course
-- ─────────────────────────────────────────────────────────────────────
-- Until now every course hub wore the same dark green. A hub fronts a
-- specific body of law and the admin who builds it should be able to make
-- it look the part: a picture behind the title band at the top, and the
-- colour the page is built around (the ring, the step markers, the
-- buttons). Both are optional — a hub that sets neither renders exactly as
-- it does today.
--
-- The picture is held as bytes rather than a link because the hero is a CSS
-- background: the browser fetches it without the bearer token the rest of
-- the API expects, so it has to come from an endpoint that needs no auth.
-- `hero_image` remains for admins who would rather point at a URL they
-- already host.
ALTER TABLE course_hubs ADD COLUMN hero_image TEXT;
ALTER TABLE course_hubs ADD COLUMN accent TEXT;
ALTER TABLE course_hubs ADD COLUMN hero_blob BLOB;
ALTER TABLE course_hubs ADD COLUMN hero_mime TEXT;
