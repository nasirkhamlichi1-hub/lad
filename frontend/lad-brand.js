/* ═══════════════════════════════════════════════════════════════════════
 * lad-brand.js — the Department's two marks, on every page
 * ═══════════════════════════════════════════════════════════════════════
 * The Government of Dubai crest and the LAD wordmark appear together on
 * official material, never one alone, and swap corners between LTR and
 * RTL. Rather than hand-edit the <body> of 32 pages — 16 of which carry a
 * fixed or sticky nav pinned to the top — this injects the brand bar and
 * the footer at runtime and moves anything already anchored at the top
 * down to make room for it.
 *
 * Safe to include twice. Safe on pages that render their own chrome.
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__ladBrand) return; window.__ladBrand = true;

  // Official artwork, served by the Department. Point these at local
  // copies (e.g. 'img/lad/gov_new.svg') once the files are in the repo —
  // the markup and the fallback below do not change.
  var ART = {
    crest:    'https://legal.dubai.gov.ae/assets/govlogo/gov_new.svg',
    wordmark: 'https://legal.dubai.gov.ae/assets/govlogo/ladlogo.svg',
    home:     'https://legal.dubai.gov.ae/'
  };

  var NAME = 'The Government of Dubai Legal Affairs Department';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // A broken image is worse than no image on official material, so each
  // mark falls back to a typographic lockup rather than an empty box.
  function mark(kind) {
    var a = document.createElement('a');
    a.className = kind === 'crest' ? 'lad-crest' : 'lad-wordmark';
    a.href = ART.home; a.target = '_blank'; a.rel = 'noopener';
    a.setAttribute('aria-label', kind === 'crest' ? 'Government of Dubai' : NAME);
    var img = document.createElement('img');
    img.alt = kind === 'crest' ? 'Government of Dubai' : NAME;
    img.decoding = 'async'; img.loading = 'eager';
    img.onerror = function () {
      var f = document.createElement('span');
      f.className = 'lad-lockup';
      f.innerHTML = kind === 'crest'
        ? '<b>Government of Dubai</b>حكومة دبي'
        : '<b>Legal Affairs Department</b>دائرة الشؤون القانونية';
      a.replaceChild(f, img);
    };
    img.src = kind === 'crest' ? ART.crest : ART.wordmark;
    a.appendChild(img);
    return a;
  }

  function brandBar() {
    var bar = document.createElement('header');
    bar.className = 'lad-brandbar';
    bar.id = 'ladBrandBar';
    // Crest leads in LTR, wordmark closes; the flex row reverses itself
    // under [dir=rtl] so the crest lands top-right without new markup.
    bar.appendChild(mark('crest'));
    bar.appendChild(mark('wordmark'));
    return bar;
  }

  function footer() {
    var f = document.createElement('footer');
    f.className = 'lad-footer';
    f.id = 'ladFooter';
    var year = new Date().getFullYear();
    f.innerHTML =
      '<div class="lad-footer-in">' +
        '<div class="lad-rule"></div>' +
        '<div class="lad-foot-name">' + esc(NAME) + '</div>' +
        '<div class="lad-foot-meta">' +
          '<a href="tel:800523">800 523</a> &nbsp;·&nbsp; ' +
          '<a href="https://legal.dubai.gov.ae" target="_blank" rel="noopener">legal.dubai.gov.ae</a>' +
        '</div>' +
        '<div class="lad-foot-meta">© ' + year + ' ' + esc(NAME) + '</div>' +
      '</div>';
    return f;
  }

  // Anything pinned across the top of the viewport has to come down by the
  // height of the bar. Deliberately narrow: a top navigation spans most of
  // the width and is short. A full-height side drawer (the messages panel)
  // is also position:fixed at top:0 and must NOT be touched.
  function makeRoom(barH) {
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var moved = [];
    var all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === 'ladBrandBar' || el.closest('#ladBrandBar')) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      var top = parseFloat(cs.top);
      if (isNaN(top) || top > 2) continue;              // not anchored to the top
      var r = el.getBoundingClientRect();
      if (r.width < vw * 0.6) continue;                 // a side panel, not a top bar
      if (r.height > 200) continue;                     // a full-height overlay
      el.style.top = (top + barH) + 'px';
      moved.push(el);
    }
    return moved;
  }

  function boot() {
    if (!document.body || document.getElementById('ladBrandBar')) return;

    var html = document.documentElement;
    if (!html.getAttribute('lang')) html.setAttribute('lang', 'en');

    var bar = brandBar();
    document.body.insertBefore(bar, document.body.firstChild);

    // Measure after insertion — the bar's height comes from the stylesheet,
    // and if the stylesheet failed to load there is nothing to make room for.
    var barH = bar.getBoundingClientRect().height;
    if (barH > 0) {
      makeRoom(barH);
      // Some pages clear their own fixed nav with a scroll-margin; keep
      // in-page anchors landing below both bars.
      html.style.scrollPaddingTop = barH + 'px';
    }

    // A page that manages its own scrolling (a full-viewport application
    // shell) would hide a footer or break its layout. Those pages still
    // carry both marks in the bar, which is what the identity requires.
    var bodyCs = getComputedStyle(document.body);
    var locked = bodyCs.overflow === 'hidden' || bodyCs.overflowY === 'hidden' ||
                 getComputedStyle(html).overflow === 'hidden';
    if (!locked && !document.getElementById('ladFooter') &&
        !document.body.hasAttribute('data-lad-no-footer')) {
      document.body.appendChild(footer());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
