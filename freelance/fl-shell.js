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

  // This portal draws the Department's marks and the language control itself,
  // in the bar below, so the shared identity files must not add a second set.
  // The attribute goes on now, while the document is still parsing: by the
  // time lad-i18n.js looks for it on DOMContentLoaded it is there, and its
  // floating switch stands down rather than mounting and being removed —
  // which its own re-placement would only undo. lad-brand.js runs deferred,
  // so its bar is taken away in draw() instead.
  var drawsChrome = !(script && script.getAttribute('data-nav') === 'none');
  if (drawsChrome) document.documentElement.setAttribute('data-lad-lang-switch', 'nav');

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
    if (!me) { location.replace('signin.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search)); return; }
    var ok = want === 'admin' ? isAdmin : (isAdmin || isLearner);
    if (!ok) {
      // A firm officer or a provider account has no home on this portal at
      // all: sign them out rather than bounce them round a loop.
      if (!isAdmin && !isLearner) { try { api.logout(); } catch (e) {} location.replace('signin.html?why=norole'); return; }
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

  // ─── The chrome: the Department's utility strip and dark nav ───
  // Deliberately the same two bars the public CLPD portal opens with, so a
  // lawyer moving between the two sites is on one site as far as they can
  // tell. What differs is only what this portal actually has: no Register
  // (accounts are issued, not self-served) and no catalogue menus (there is
  // nothing to browse before signing in).
  var ART = {
    gov:   'https://legal.dubai.gov.ae/assets/govlogo/gov_new.svg',
    govW:  'https://legal.dubai.gov.ae/assets/govlogo/DG_white.svg',
    ladW:  'https://legal.dubai.gov.ae/assets/govlogo/lad_logo_white.svg',
    home:  'https://legal.dubai.gov.ae',
    phone: 'https://legal.dubai.gov.ae/en/AboutDepartment/Pages/Contact-us.aspx',
  };

  function utilStrip() {
    var d = document.createElement('div');
    d.className = 'lad-util';
    d.innerHTML =
      '<div class="lad-util-inner">' +
        '<div class="lad-util-left">' +
          '<a class="lad-util-link" href="' + ART.home + '" target="_blank" rel="noopener">' +
            '<img src="' + ART.gov + '" alt="Government of Dubai" onerror="this.style.display=\'none\'">' +
          '</a>' +
          '<div class="lad-util-sep"></div>' +
          '<a class="lad-util-link" href="' + ART.home + '" target="_blank" rel="noopener">' + esc(BRAND) + '</a>' +
        '</div>' +
        '<div class="lad-util-right">' +
          '<a class="lad-util-link" href="' + ART.phone + '" target="_blank" rel="noopener">800 523</a>' +
        '</div>' +
      '</div>';
    return d;
  }

  function navBar() {
    var nav = document.createElement('nav');
    nav.className = 'lad-nav';

    // The marks, with the programme name standing in if the artwork cannot
    // be reached — an empty bar is worse than a typographic lockup.
    var logos =
      '<a class="lad-logos" href="' + (me ? homeFor() : 'index.html') + '">' +
        '<img src="' + ART.govW + '" alt="Government of Dubai" onerror="this.style.display=\'none\'">' +
        '<div class="lad-logos-sep"></div>' +
        '<img src="' + ART.ladW + '" alt="' + esc(BRAND) + '" onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.lad-logos-text\').style.display=\'block\'">' +
        '<span class="lad-logos-text" style="display:none" data-fl-brand-lockup>' + esc(BRAND) +
          '<small>' + esc(PROGRAMME) + '</small></span>' +
      '</a>';

    // Menu. Signed in, it is the two places there are to be; signed out, it is
    // the landing page's own sections.
    var menu = '';
    if (me && (isAdmin || isLearner)) {
      var onLearn = here === 'home.html' || here === 'course.html' || here === 'trainer.html';
      menu += '<a class="lad-mi' + (onLearn ? ' on' : '') + '" href="home.html">My training</a>';
      if (isAdmin) menu += '<a class="lad-mi' + (/^admin/.test(here) ? ' on' : '') + '" href="admin.html">Admin console</a>';
    } else if (here === 'index.html' || here === '') {
      menu += '<a class="lad-mi on" href="#top">Home</a>' +
              '<a class="lad-mi" href="#how">How it works</a>' +
              '<a class="lad-mi" href="' + ART.phone + '" target="_blank" rel="noopener">Contact Us</a>';
    } else {
      menu += '<a class="lad-mi" href="index.html">Home</a>';
    }

    // The language control, and then either who you are or the way in.
    var right = '<button class="lad-nav-lang" type="button" id="flLang" translate="no"></button>';
    if (me) {
      right += '<a class="lad-profile-chip" href="' + homeFor() + '">' +
                 '<span class="dot">' + esc(initials(name).toUpperCase() || '·') + '</span>' +
                 '<span class="nm">' + esc(name || 'Signed in') + '</span>' +
                 '<span class="rl">' + (isAdmin ? 'admin' : 'lawyer') + '</span>' +
               '</a>' +
               '<button class="lad-btn-login" type="button" id="flSignOut">Sign out</button>';
    } else if (here !== 'signin.html') {
      right += '<a class="lad-btn-reg" href="signin.html">Sign in</a>';
    }

    nav.innerHTML = '<div class="lad-nav-inner">' + logos +
      '<div class="lad-menus">' + menu + '</div>' +
      '<div class="lad-nav-right">' + right + '</div></div>';
    return nav;
  }

  function draw() {
    if (script && script.getAttribute('data-nav') === 'none') return;
    if (document.querySelector('.lad-nav')) return;
    // lad-brand.js adds its own crest-and-wordmark bar to any page it thinks
    // carries no Government mark. It decides that while deferred, before this
    // bar exists, so it guesses wrong here every time — and two sets of marks
    // stacked is worse than none. Ours carries them, so its bar goes.
    var bb = document.getElementById('ladBrandBar');
    if (bb && bb.parentNode) bb.parentNode.removeChild(bb);

    var first = document.body.firstChild;
    document.body.insertBefore(utilStrip(), first);
    document.body.insertBefore(navBar(), first);

    var so = document.getElementById('flSignOut'); if (so) so.onclick = signOut;

    // The switch shows the language you would be changing TO, as it does on
    // the CLPD portal. lad-i18n.js finds .lad-nav-lang and stands its own
    // floating switch down, so there is only ever one control.
    var lang = document.getElementById('flLang');
    if (lang) {
      var cur = document.documentElement.getAttribute('lang') === 'ar' ? 'ar' : 'en';
      lang.textContent = cur === 'ar' ? 'English' : 'العربية';
      lang.setAttribute('lang', cur === 'ar' ? 'en' : 'ar');
      lang.onclick = function () {
        if (window.ladSetLang) window.ladSetLang(cur === 'ar' ? 'en' : 'ar');
      };
    }

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
      Array.prototype.forEach.call(document.querySelectorAll('[data-fl-brand-lockup]'), function (el) {
        el.childNodes[0].nodeValue = b.name;
        var sm = el.querySelector('small'); if (sm) sm.textContent = PROGRAMME;
      });
    }).catch(function () {});
  }

  // ─── Session expiry ────────────────────────────────────────────
  var shown = false;
  document.addEventListener('lad:unauthenticated', function () {
    if (shown) return; shown = true;
    var bar = document.createElement('div'); bar.id = 'fl-expired';
    bar.innerHTML = '<span>Your session has ended — sign in again to carry on. Your progress is saved.</span><button type="button">Sign in</button>';
    bar.querySelector('button').onclick = function () { try { window.top.location.href = 'signin.html'; } catch (e) { location.href = 'signin.html'; } };
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
