-- 011-booking-inventory.sql
-- Seats + credit-gated booking inventory.
--
-- Seeds the live catalogue (matching the lawyer portal's course IDs) and, for
-- every face-to-face course, a row in course_sessions carrying a finite
-- capacity. Bookings decrement seats_remaining like cinema tickets until the
-- session is sold out. E-learning courses have no sessions (unlimited, instant
-- start). Session IDs are deterministic — "<courseId>#<index>" — so the
-- frontend can render live seat counts and book a specific date.
--
-- INSERT OR IGNORE keeps this safe: it never resets seats already sold.

-- ─── Courses ─────────────────────────────────────────────────────────
INSERT OR IGNORE INTO courses (id, title, category, type, format, pts, credits, provider_id, location, description, language, active, bg, icon) VALUES
  ('ai-governance',    'AI Governance: Legal Risk & Compliance',            'AI & Ethics',  'mandatory', 'e-learning',   2, 5, NULL, 'Online · Self-paced', 'AI governance, legal risk frameworks and UAE compliance obligations for practitioners.', 'English', 1, 'linear-gradient(135deg,#3b0764,#1e1b4b)', ''),
  ('responsible-ai',   'Responsible Use of AI for Legal Professionals',     'AI & Ethics',  'mandatory', 'e-learning',   2, 5, NULL, 'Online · Self-paced', 'Responsible, compliant integration of AI into UAE legal practice.', 'English', 1, 'linear-gradient(135deg,#1e1b4b,#0a0e14)', ''),
  ('intl-arbitration', 'International Arbitration & the Courts',             'Arbitration',  'mandatory', 'face-to-face', 2, 5, NULL, 'Gate Village Bldg 02, Level 1 — DIFC', 'How the DIFC and ADGM Courts interact with arbitration at every stage.', 'English', 1, 'linear-gradient(135deg,#0a2040,#020817)', ''),
  ('aml-update',       'Anti Money Laundering (Update 2026)',               'Regulatory',   'mandatory', 'face-to-face', 2, 5, NULL, 'Al Hudaiba Awards Building, Block C, M Floor', 'UAE AML/CFT architecture, Federal Decree-Law No.10 of 2025 and the goAML platform.', 'English', 1, 'linear-gradient(135deg,#1a0a30,#2d1b69)', ''),
  ('mediation',        'Mediation Skills for Lawyers (SOLVE Methodology)',  'Dispute Res.', 'mandatory', 'face-to-face', 2, 5, NULL, 'Al Hudaiba Awards Building, Block C, M Floor', 'The SOLVE mediation methodology with UAE commercial mediation examples.', 'English', 1, 'linear-gradient(135deg,#3a2a1a,#1a1208)', ''),
  ('construction',     'Real Estate & Construction Laws — Case Trends UAE', 'Construction', 'mandatory', 'face-to-face', 2, 5, NULL, 'Al Hudaiba Awards Building, Block C, M Floor', 'UAE construction law with emphasis on recent judicial decisions and FIDIC.', 'English', 1, 'linear-gradient(135deg,#2a3a1a,#0a1a08)', '');

-- ─── Face-to-face sessions (finite seats) ────────────────────────────
INSERT OR IGNORE INTO course_sessions (id, course_id, scheduled_at, end_at, capacity, seats_remaining, venue, language, status) VALUES
  ('intl-arbitration#0', 'intl-arbitration', '2026-05-28T09:00:00Z', '2026-05-28T15:00:00Z',  3,  3, 'DIFC — Lecture Room 3',                       'English', 'open'),
  ('intl-arbitration#1', 'intl-arbitration', '2026-06-16T09:00:00Z', '2026-06-16T15:00:00Z', 18, 18, 'DIFC — Lecture Room 3',                       'English', 'open'),
  ('aml-update#0',       'aml-update',       '2026-05-20T12:00:00Z', '2026-05-20T14:00:00Z', 15, 15, 'Al Hudaiba Awards Building, Block C',          'English', 'open'),
  ('aml-update#1',       'aml-update',       '2026-06-02T09:30:00Z', '2026-06-02T11:30:00Z', 23, 23, 'Al Hudaiba Awards Building, Block C',          'English', 'open'),
  ('aml-update#2',       'aml-update',       '2026-06-29T12:00:00Z', '2026-06-29T14:00:00Z', 24, 24, 'Al Hudaiba Awards Building, Block C',          'Arabic',  'open'),
  ('aml-update#3',       'aml-update',       '2026-06-30T12:00:00Z', '2026-06-30T14:00:00Z', 23, 23, 'Al Hudaiba Awards Building, Block C',          'Arabic',  'open'),
  ('mediation#0',        'mediation',        '2026-06-18T09:00:00Z', '2026-06-18T11:00:00Z', 22, 22, 'Al Hudaiba Awards Building, Block C',          'English', 'open'),
  ('mediation#1',        'mediation',        '2026-07-14T14:00:00Z', '2026-07-14T16:00:00Z', 30, 30, 'Al Hudaiba Awards Building, Block C',          'English', 'open'),
  ('construction#0',     'construction',     '2026-05-21T09:00:00Z', '2026-05-21T11:00:00Z', 31, 31, 'Al Hudaiba Awards Building, Block C',          'English', 'open'),
  ('construction#1',     'construction',     '2026-06-04T12:00:00Z', '2026-06-04T14:00:00Z', 28, 28, 'Al Hudaiba Awards Building, Block C',          'English', 'open'),
  ('construction#2',     'construction',     '2026-07-01T09:30:00Z', '2026-07-01T11:30:00Z', 35, 35, 'Al Hudaiba Awards Building, Block C',          'Arabic',  'open');

-- Prevent a lawyer double-booking the same active session (cinema seat integrity).
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_session
  ON bookings (lawyer_id, session_id)
  WHERE session_id IS NOT NULL AND status IN ('booked', 'attended');
