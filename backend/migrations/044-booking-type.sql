-- Classify every booking so reporting can divide them into public / internal /
-- partner, and so partner (complimentary) seats can be booked free of credits.
--   public   — a paid public CLPD course (credits spent)
--   internal — a firm's own internally-accredited course (free to its lawyers)
--   partner  — a complimentary / sponsored / partner seat (free, admin-granted)
ALTER TABLE bookings ADD COLUMN booking_type TEXT DEFAULT 'public';
CREATE INDEX IF NOT EXISTS idx_bookings_type ON bookings (booking_type);
