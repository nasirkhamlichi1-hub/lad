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

  // ─── 4. When the API says the session is gone, SAY SO ─────────────
  // api-client clears the stored token on any 401 and fires this event.
  // Without it, the page keeps showing the signed-in header (name and
  // role are cached separately) while every action fails with the bare
  // word "Unauthenticated" — which reads as a bug, not a timeout.
  var expiredShown = false;
  document.addEventListener('lad:unauthenticated', function () {
    if (expiredShown) return;
    expiredShown = true;
    var show = function () {
      if (!document.body) return;
      var bar = document.createElement('div');
      bar.id = 'lad-session-expired';
      bar.setAttribute('style',
        'position:fixed;top:0;left:0;right:0;z-index:99999;' +
        'background:#0a1f16;color:#fff;' +
        "font:600 13.5px/1.4 Inter,system-ui,sans-serif;" +
        'padding:12px 18px;display:flex;gap:14px;align-items:center;' +
        'justify-content:center;flex-wrap:wrap;box-shadow:0 4px 14px rgba(0,0,0,.3)');
      var msg = document.createElement('span');
      msg.textContent = 'Your session has expired — sign in again to continue.';
      var btn = document.createElement('button');
      btn.textContent = 'Sign in';
      btn.setAttribute('style',
        'background:#00925A;color:#fff;border:none;border-radius:8px;' +
        "padding:8px 18px;font:600 13px Inter,system-ui,sans-serif;cursor:pointer");
      btn.onclick = function () {
        try {
          localStorage.removeItem('lad_token');
          localStorage.removeItem('lad_role');
        } catch (_) {}
        // #public keeps index.html on the landing (with its sign-in)
        // even if a stale token is still lying around. window.top so the
        // whole CRM navigates when this fires inside an embedded pane.
        try { window.top.location.href = 'index.html#public'; }
        catch (_) { window.location.href = 'index.html#public'; }
      };
      bar.appendChild(msg); bar.appendChild(btn);
      document.body.appendChild(bar);
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
  });
})();
