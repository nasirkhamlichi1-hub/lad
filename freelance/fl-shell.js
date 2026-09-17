/* ─────────────────────────────────────────────────────────────────────
 * fl-shell.js — the portal chrome and the front-end half of access control
 * ─────────────────────────────────────────────────────────────────────
 * The Department's freelance-lawyers training portal. Include after
 * fl-api.js, declaring who may open the page:
 *
 *   <script src="fl-shell.js" data-roles="learner"></script>     lawyers and admins
 *   <script src="fl-shell.js" data-roles="admin"></script>       admins only
 *   <script src="fl-shell.js" data-roles="public"></script>      no sign-in needed
 *
 * It draws the top bar and footer, reads the brand name from the API, sends
 * anyone without the right role to their own home, and shows a sign-in bar
 * when the API says the session has expired. The backend enforces every
 * endpoint with 401/403 regardless — this just keeps people off pages they
 * cannot use.
 * ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  var api = window.FL;
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var want = ((script && script.getAttribute('data-roles')) || 'learner').trim();
  var embed = /[?&]embed=1/.test(location.search);
  if (embed) document.documentElement.classList.add('fl-embed');

  var ADMIN = ['lad_admin', 'lad_super_admin', 'super_admin', 'dg'];
  // A freelance lawyer signs in as role `lawyer`. The staff learner roles
  // stay so an admin's own staff can be enrolled to preview a course.
  var LEARNER = ['lawyer', 'lad_staff', 'lad_staff_training', 'staff_training', 'trainee'];

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
      // A firm officer or a provider account has no home on this portal at
      // all: sign them out rather than bounce them round a loop.
      if (!isAdmin && !isLearner) { try { api.logout(); } catch (e) {} location.replace('index.html?why=norole'); return; }
      location.replace(homeFor()); return;
    }
  }

  // ─── The chrome ────────────────────────────────────────────────
  var BRAND = 'Legal Affairs Department';
  var PROGRAMME = 'Freelance Lawyers Training';
  try { BRAND = sessionStorage.getItem('fl_brand_name') || BRAND; } catch (e) {}

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function initials(n) { var p = String(n || '').split(/\s+/).filter(Boolean); return ((p[0] || '')[0] || '' ) + ((p.length > 1 ? p[p.length - 1][0] : '') || ''); }
  var here = location.pathname.split('/').pop() || 'index.html';

  function draw() {
    if (script && script.getAttribute('data-nav') === 'none') return;
    if (document.querySelector('.fl-nav')) return;
    var links = '';
    if (me && (isAdmin || isLearner)) {
      links += '<a href="home.html"' + (here === 'home.html' || here === 'course.html' || here === 'trainer.html' ? ' class="active"' : '') + '>My training</a>';
      if (isAdmin) links += '<a href="admin.html"' + (/^admin/.test(here) ? ' class="active"' : '') + '>Admin console</a>';
    }
    var right = me
      ? '<div class="fl-user"><span class="av">' + esc(initials(name).toUpperCase() || '·') + '</span><span class="n">' + esc(name || 'Signed in') + '</span><span class="r">' + (isAdmin ? 'admin' : 'lawyer') + '</span></div>' +
        '<button class="fl-signout" type="button" id="flSignOut">Sign out</button>'
      : '';
    var nav = document.createElement('header');
    nav.className = 'fl-nav';
    nav.innerHTML = '<a class="fl-brand" href="' + (me ? homeFor() : 'index.html') + '"><span class="fl-mark"></span><span><b data-fl-brand>' + esc(BRAND) + '</b><small>' + esc(PROGRAMME) + '</small></span></a>' +
      '<nav class="fl-links">' + links + '</nav><div class="fl-right">' + right + '</div>';
    // Beneath the Government bar (lad-brand.js puts it first), above everything else.
    var bar = document.getElementById('ladBrandBar');
    document.body.insertBefore(nav, bar ? bar.nextSibling : document.body.firstChild);
    var so = document.getElementById('flSignOut'); if (so) so.onclick = signOut;

    // The Department's own footer (lad-brand.js) closes every page; the
    // portal adds one line of its own above it.
    if (!document.querySelector('.fl-foot') && !(script && script.getAttribute('data-foot') === 'none')) {
      var foot = document.createElement('div');
      foot.className = 'fl-foot';
      foot.innerHTML = '<span>' + esc(PROGRAMME) + '</span><span>Progress is saved as you go — you can always come back.</span>';
      var lf = document.getElementById('ladFooter');
      if (lf) document.body.insertBefore(foot, lf); else document.body.appendChild(foot);
    }
  }

  // The brand name comes from the API so the same pages serve any instance.
  function loadBrand() {
    if (!api || !api.enabled) return;
    api.brand().then(function (b) {
      if (!b || !b.name) return;
      BRAND = b.name;
      if (b.programme) PROGRAMME = b.programme;
      try { sessionStorage.setItem('fl_brand_name', b.name); } catch (e) {}
      Array.prototype.forEach.call(document.querySelectorAll('[data-fl-brand]'), function (el) { el.textContent = b.name; });
      Array.prototype.forEach.call(document.querySelectorAll('[data-fl-programme]'), function (el) { el.textContent = PROGRAMME; });
    }).catch(function () {});
  }

  // ─── Session expiry ────────────────────────────────────────────
  var shown = false;
  document.addEventListener('lad:unauthenticated', function () {
    if (shown) return; shown = true;
    var bar = document.createElement('div'); bar.id = 'fl-expired';
    bar.innerHTML = '<span>Your session has ended — sign in again to carry on. Your progress is saved.</span><button type="button">Sign in</button>';
    bar.querySelector('button').onclick = function () { try { window.top.location.href = 'index.html'; } catch (e) { location.href = 'index.html'; } };
    document.body.appendChild(bar);
  });

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function () { draw(); loadBrand(); });

  window.FLShell = {
    me: me, role: role, isAdmin: isAdmin, isLearner: isLearner, name: name,
    home: homeFor, signOut: signOut, brand: function () { return BRAND; },
    toast: function (msg, err) {
      var t = document.getElementById('flToast');
      if (!t) { t = document.createElement('div'); t.id = 'flToast'; t.className = 'fl-toast'; document.body.appendChild(t); }
      t.textContent = msg; t.className = 'fl-toast on' + (err ? ' err' : '');
      clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('on'); }, 3400);
    },
  };
})();
