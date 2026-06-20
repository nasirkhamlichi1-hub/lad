/* ─────────────────────────────────────────────────────────────────────
 * LAD CLPD frontend — runtime configuration
 * ─────────────────────────────────────────────────────────────────────
 * This file is the ONE place where environment-specific values live.
 * Every HTML portal should load this BEFORE api-client.js:
 *
 *   <script src="runtime-config.js"></script>
 *   <script src="api-client.js"></script>
 *
 * To point at a different environment (staging vs production), just edit
 * the LAD_API_BASE value below and redeploy. No source-code changes.
 *
 * If LAD_API_BASE is empty (the default), every portal runs in demo mode
 * using localStorage — useful for static previews with no backend connected.
 * ─────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ─── EDIT THIS ─────────────────────────────────────────────────────
  // Production backend (Render, Frankfurt — Docker, persistent disk):
  window.LAD_API_BASE = 'https://lad-clpd-backend.onrender.com';
  // Previous (Azure App Service): 'https://clpd-lad-api-0878.azurewebsites.net'
  // Demo/empty: ''  (use localStorage fallback)
  // ─── END EDIT ──────────────────────────────────────────────────────

  // Local development: when the frontend is served from localhost/127.0.0.1,
  // talk to the local backend (npm start, port 4000) instead of production, so
  // a developer can test end-to-end against their own server + DB. The backend
  // CORS allow-list includes http://localhost:8080, so serve the frontend there.
  if (typeof location !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.LAD_API_BASE = 'http://localhost:4000';
  }

  // Detect environment for logging / debugging only
  window.LAD_ENV = (function () {
    const host = (typeof location !== 'undefined' && location.hostname) || '';
    if (!window.LAD_API_BASE) return 'demo';
    if (host === 'localhost' || host === '127.0.0.1') return 'local';
    return 'production';
  })();

  // Surface a tiny console line so testers can confirm which env they hit
  if (typeof console !== 'undefined' && console.info) {
    console.info('%cLAD CLPD %c' + window.LAD_ENV + '%c · api=' + (window.LAD_API_BASE || 'localStorage'),
      'font-weight:600;color:#006B3F', 'background:#006B3F;color:#fff;padding:1px 6px;border-radius:3px',
      'color:#64748b;font-family:monospace;font-size:11px');
  }
})();
