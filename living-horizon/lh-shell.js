/* ─────────────────────────────────────────────────────────────────────
 * lh-shell.js — the portal chrome and the front-end half of access control
 * ─────────────────────────────────────────────────────────────────────
 * Include after lh-api.js, declaring who may open the page:
 *
 *   <script src="lh-shell.js" data-roles="learner"></script>     staff and admins
 *   <script src="lh-shell.js" data-roles="admin"></script>       admins only
 *   <script src="lh-shell.js" data-roles="public"></script>      no sign-in needed
 *
 * It draws the top bar and footer, reads the brand name from the API, sends
 * anyone without the right role to their own home, and shows a sign-in bar
 * when the API says the session has expired. The backend enforces every
 * endpoint with 401/403 regardless — this just keeps people off pages they
 * cannot use.
 * ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  var api = window.LH;
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var want = ((script && script.getAttribute('data-roles')) || 'learner').trim();
  var embed = /[?&]embed=1/.test(location.search);
  if (embed) document.documentElement.classList.add('lh-embed');

  var ADMIN = ['lad_admin', 'lad_super_admin', 'super_admin', 'dg'];
  var LEARNER = ['lad_staff', 'lad_staff_training', 'staff_training', 'trainee'];

  function tokenRole() {
    var t = api && api.getToken ? api.getToken() : '';
    if (!t) return null;
    try {
      var me = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { role: me.role || '', name: me.name || '', sub: me.sub || '', exp: me.exp || 0 };
    } catch (e) { return null; }
  }
  var me = tokenRole();
  var role = me ? me.role : '';
  var isAdmin = ADMIN.indexOf(role) >= 0;
  var isLearner = LEARNER.indexOf(role) >= 0;
  var name = '';
  try { name = localStorage.getItem('lad_name') || (me && me.name) || ''; } catch (e) { name = (me && me.name) || ''; }

  function homeFor() { return isAdmin ? 'admin.html' : (isLearner ? 'home.html' : 'index.html'); }
  function signOut() { try { api.logout(); } catch (e) {} location.href = 'index.html'; }

  // ─── The gate ──────────────────────────────────────────────────
  if (!embed && want !== 'public') {
    if (!me) { location.replace('index.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search)); return; }
    var ok = want === 'admin' ? isAdmin : (isAdmin || isLearner);
    if (!ok) {
      // A lawyer, a firm officer or a provider account has no home on this
      // portal at all: sign them out rather than bounce them round a loop.
      if (!isAdmin && !isLearner) { try { api.logout(); } catch (e) {} location.replace('index.html?why=norole'); return; }
      location.replace(homeFor()); return;
    }
  }

  // ─── The chrome ────────────────────────────────────────────────
  var BRAND = 'Living Horizon';
  try { BRAND = sessionStorage.getItem('lh_brand_name') || BRAND; } catch (e) {}

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function initials(n) { var p = String(n || '').split(/\s+/).filter(Boolean); return ((p[0] || '')[0] || '' ) + ((p.length > 1 ? p[p.length - 1][0] : '') || ''); }
  var here = location.pathname.split('/').pop() || 'index.html';

  function draw() {
    if (script && script.getAttribute('data-nav') === 'none') return;
    if (document.querySelector('.lh-nav')) return;
    var links = '';
    if (me && (isAdmin || isLearner)) {
      links += '<a href="home.html"' + (here === 'home.html' || here === 'course.html' || here === 'trainer.html' ? ' class="active"' : '') + '>My training</a>';
      if (isAdmin) links += '<a href="admin.html"' + (/^admin/.test(here) ? ' class="active"' : '') + '>Admin console</a>';
    }
    var right = me
      ? '<div class="lh-user"><span class="dot">' + esc(initials(name).toUpperCase() || '·') + '</span><span class="n">' + esc(name || 'Signed in') + '</span><span class="r">' + (isAdmin ? 'admin' : 'staff') + '</span></div>' +
        '<button class="lh-signout" type="button" id="lhSignOut">Sign out</button>'
      : '';
    var nav = document.createElement('header');
    nav.className = 'lh-nav';
    nav.innerHTML = '<a class="lh-brand" href="' + (me ? homeFor() : 'index.html') + '"><span class="lh-mark"></span><span><b data-lh-brand>' + esc(BRAND) + '</b><small>Staff training</small></span></a>' +
      '<nav class="lh-links">' + links + '</nav><div class="lh-right">' + right + '</div>';
    document.body.insertBefore(nav, document.body.firstChild);
    var so = document.getElementById('lhSignOut'); if (so) so.onclick = signOut;

    if (!document.querySelector('.lh-foot') && !(script && script.getAttribute('data-foot') === 'none')) {
      var foot = document.createElement('footer');
      foot.className = 'lh-foot';
      foot.innerHTML = '<span><span data-lh-brand>' + esc(BRAND) + '</span> · Staff training portal</span><span>Progress is saved as you go — you can always come back.</span>';
      document.body.appendChild(foot);
    }
  }

  // The brand name comes from the API so the same pages serve any instance.
  function loadBrand() {
    if (!api || !api.enabled) return;
    api.brand().then(function (b) {
      if (!b || !b.name) return;
      BRAND = b.name;
      try { sessionStorage.setItem('lh_brand_name', b.name); } catch (e) {}
      Array.prototype.forEach.call(document.querySelectorAll('[data-lh-brand]'), function (el) { el.textContent = b.name; });
      if (document.title.indexOf(b.name) < 0 && /Living Horizon/.test(document.title)) document.title = document.title.replace('Living Horizon', b.name);
    }).catch(function () {});
  }

  // ─── Session expiry ────────────────────────────────────────────
  var shown = false;
  document.addEventListener('lad:unauthenticated', function () {
    if (shown) return; shown = true;
    var bar = document.createElement('div'); bar.id = 'lh-expired';
    bar.innerHTML = '<span>Your session has ended — sign in again to carry on. Your progress is saved.</span><button type="button">Sign in</button>';
    bar.querySelector('button').onclick = function () { try { window.top.location.href = 'index.html'; } catch (e) { location.href = 'index.html'; } };
    document.body.appendChild(bar);
  });

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function () { draw(); loadBrand(); });

  window.LHShell = {
    me: me, role: role, isAdmin: isAdmin, isLearner: isLearner, name: name,
    home: homeFor, signOut: signOut, brand: function () { return BRAND; },
    toast: function (msg, err) {
      var t = document.getElementById('lhToast');
      if (!t) { t = document.createElement('div'); t.id = 'lhToast'; t.className = 'lh-toast'; document.body.appendChild(t); }
      t.textContent = msg; t.className = 'lh-toast on' + (err ? ' err' : '');
      clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('on'); }, 3400);
    },
  };
})();
