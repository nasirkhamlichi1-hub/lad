'use strict';

// The tracks a course may belong to. The key is what the database holds;
// the names are what the two sites show. Order here is display order.
const TRACKS = [
  { key: 'legal', en: 'Legal Practice', ar: 'الممارسة القانونية' },
  { key: 'operations', en: 'Practice Operations', ar: 'إدارة المكتب' },
];
const KEYS = TRACKS.map((t) => t.key);

// A track as stored: one of the keys, or null for "not placed".
function cleanTrack(v) {
  const k = String(v == null ? '' : v).trim().toLowerCase();
  return KEYS.includes(k) ? k : null;
}

module.exports = { TRACKS, KEYS, cleanTrack };
