/* ─────────────────────────────────────────────────────────────────────
 * Freelance Lawyers Training — runtime configuration
 * ─────────────────────────────────────────────────────────────────────
 * The ONE place environment-specific values live. Every page loads this
 * before fl-api.js:
 *
 *   <script src="runtime-config.js"></script>
 *   <script src="fl-api.js"></script>
 *
 * To point the portal at a different backend, edit FL_API_BASE and push.
 * ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ─── EDIT THIS ─────────────────────────────────────────────────────
  // The freelance-lawyers backend (Azure App Service running the container
  // with APP_BRAND=freelance). See docs/FREELANCE.md.
  var FL_API_BASE = 'https://lad-freelance-api.azurewebsites.net';
  // ─── END EDIT ──────────────────────────────────────────────────────

  // Local development: served from localhost (npm start mounts this folder
  // at http://localhost:4000/freelance/), talk to the local backend.
  if (typeof location !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    FL_API_BASE = location.protocol + '//' + location.hostname + ':' + (location.port || '4000');
  }

  window.FL_API_BASE = FL_API_BASE;
  // The API client was built for the shared platform and reads this name.
  window.LAD_API_BASE = FL_API_BASE;
  window.FL_ENV = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'local' : 'production';
})();
