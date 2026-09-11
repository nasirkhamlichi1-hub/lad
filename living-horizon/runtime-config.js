/* ─────────────────────────────────────────────────────────────────────
 * Living Horizon Training — runtime configuration
 * ─────────────────────────────────────────────────────────────────────
 * The ONE place environment-specific values live. Every page loads this
 * before lh-api.js:
 *
 *   <script src="runtime-config.js"></script>
 *   <script src="lh-api.js"></script>
 *
 * To point the portal at a different backend, edit LH_API_BASE and push.
 * ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ─── EDIT THIS ─────────────────────────────────────────────────────
  // The Living Horizon backend (Azure App Service running the container
  // with APP_BRAND=living-horizon). See docs/LIVING-HORIZON.md.
  var LH_API_BASE = 'https://living-horizon-training-api.azurewebsites.net';
  // ─── END EDIT ──────────────────────────────────────────────────────

  // Local development: served from localhost (npm start mounts this folder
  // at http://localhost:4000/lh/), talk to the local backend.
  if (typeof location !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    LH_API_BASE = location.protocol + '//' + location.hostname + ':' + (location.port || '4000');
  }

  window.LH_API_BASE = LH_API_BASE;
  // The API client was built for the shared platform and reads this name.
  window.LAD_API_BASE = LH_API_BASE;
  window.LH_ENV = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'local' : 'production';
})();
