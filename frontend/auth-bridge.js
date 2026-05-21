/**
 * LAD CLPD — Auth bridge
 * ---------------------------------------------------------------------
 * Runs on every portal page load. Two responsibilities:
 *
 *   1. If the URL fragment contains a JWT (#token=...), store it in
 *      localStorage and clean the URL. This is the redirect target after
 *      UAE Pass authenticates the user.
 *
 *   2. Expose a tiny login UI for unauthenticated visitors to start the
 *      UAE Pass flow.
 *
 * Include in every portal HTML:
 *   <script src="api-client.js"></script>
 *   <script src="auth-bridge.js"></script>
 */
(function () {
  'use strict';

  if (!window.LAD) {
    console.warn('[auth-bridge] window.LAD not found — include api-client.js first');
    return;
  }

  // ─── 1. Capture token from URL fragment ───────────────────────────
  if (location.hash && location.hash.includes('token=')) {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('token');
    const role = params.get('role');
    const name = params.get('name');
    const err = params.get('error');

    if (token) {
      window.LAD.setToken(token);
      if (role) localStorage.setItem('lad_role', role);
      if (name) localStorage.setItem('lad_name', name);
      // Remove the fragment so the token doesn't end up in shareable links
      history.replaceState(null, '', location.pathname + location.search);
    } else if (err) {
      console.warn('[auth-bridge] UAE Pass error:', err, params.get('desc'));
      if (err === 'no_lad_record') {
        const eid = params.get('emirates_id') || '';
        alert(
          'UAE Pass authentication succeeded, but no LAD record matches your Emirates ID' +
          (eid ? ' (' + eid + ')' : '') +
          '.\n\nPlease contact LAD support at support@legal.dubai.gov.ae'
        );
      }
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // ─── 2. Inject a UAE Pass login button if the page wants one ──────
  // Any element with `data-lad-login-uaepass` becomes a login trigger.
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-lad-login-uaepass]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        window.LAD.loginWithUaePass();
      });
    });

    document.querySelectorAll('[data-lad-logout]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        window.LAD.ladSignOut();
      });
    });
  });

  // ─── 3. Expose helpers ────────────────────────────────────────────
  window.LAD.currentUser = function () {
    if (!window.LAD.isAuthenticated()) return null;
    return {
      role: localStorage.getItem('lad_role') || 'unknown',
      name: localStorage.getItem('lad_name') || '',
    };
  };

  // Sign out — clear local auth state and send the user back to the
  // public landing. Safe to call from any page; doesn't depend on the
  // backend being reachable.
  window.LAD.ladSignOut = function () {
    try { window.LAD.logout && window.LAD.logout(); } catch (_) {}
    try {
      localStorage.removeItem('lad_role');
      localStorage.removeItem('lad_name');
      localStorage.removeItem('lad_token');
    } catch (_) {}
    // Send users back to the canonical entry — '/' resolves to index.html
    // which then decides whether to show the public landing or route to a
    // role portal if they're still authenticated elsewhere.
    window.location.href = '/';
  };
})();
