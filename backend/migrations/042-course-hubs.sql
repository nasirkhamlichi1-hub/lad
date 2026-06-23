-- Knowledge hubs: the public reference page that sits in FRONT of the AI
-- trainer for a course (primary legislation, key points, FAQ). One hub per
-- course, keyed by the SAME course_id the trainer lessons use — so a single
-- upload of course content drives BOTH the hub and the AI trainer.
CREATE TABLE IF NOT EXISTS course_hubs (
  course_id   TEXT PRIMARY KEY,           -- matches trainer_lessons.course_id
  title       TEXT,
  eyebrow     TEXT,                        -- small kicker above the title
  intro       TEXT,                        -- lede paragraph
  legislation TEXT DEFAULT '[]',           -- JSON: [{group,year,tag,title,subtitle,summary,points[]}]
  faq         TEXT DEFAULT '[]',           -- JSON: [{q,a}]
  cta_label   TEXT,                        -- e.g. "Start the AI Training"
  cta_url     TEXT,                        -- where the CTA goes (the live trainer)
  published   INTEGER NOT NULL DEFAULT 0,  -- 0 draft, 1 live
  updated_at  TEXT,
  updated_by  TEXT
);
