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
 * A page that already prints the marks in its own chrome gets NO bar: on
 * those pages the injected one is a second (on clpd-portal, a third) copy
 * of the same crest stacked above the page's own masthead, and the offset
 * makeRoom() applies to clear it pushes the page's fixed furniture into
 * whatever else is pinned to the top. See alreadyBranded() below.
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

  /* ─── Is the page already carrying the marks? ────────────────────────
   * Half the pages in this system print the crest and the wordmark in
   * their own masthead (clpd-portal prints the crest twice on its own —
   * once in the utility strip, once in the dark nav). Adding the bar
   * there stacks the same artwork two or three deep. The rule below is
   * deliberately biased towards SKIPPING: a page that keeps its own marks
   * and loses the bar still shows the identity, whereas a page that gets
   * both shows it wrong. Only the bar is affected — the footer is decided
   * separately and still goes on every scrolling page.                  */

  // The artwork the Department serves. Any reference to it, anywhere in
  // the document, means the page is already showing an official mark.
  var ART_RE = /(gov_new\.svg|DG_white\.svg|ladlogo\.svg|lad_logo_white\.svg|legal\.dubai\.gov\.ae\/assets\/govlogo)/i;

  // Names that only ever describe the crest/wordmark lockup itself, so an
  // image of any kind inside one is taken to be the mark. Deliberately NOT
  // bare "logo"/"logos": the application shells use those for their own
  // initial tile (lad-crm's "LAD" square, hub's generic shield), which is
  // not a Government mark — reading those as one would strip the identity
  // from the very pages that have none of their own.
  var NAME_RE = /(^|[^a-z])(crest|wordmark|lockup|govlogo|gov-logo|gov-crest)([^a-z]|$)/i;

  // Weaker names: "brand-mark" is used here for a coloured gradient tile
  // with initials in it, so only a real image asset counts, never an
  // inline <svg> and never a gradient.
  var WEAK_NAME_RE = /(^|[^a-z])(brandmark|brand-mark|brand-logo)([^a-z]|$)/i;

  // What the marks are called in alt text, in both languages.
  var ALT_RE = /(government of dubai|legal affairs department|حكومة دبي|دائرة الشؤون القانونية)/i;

  // Chrome the page draws for itself, however it is labelled.
  var CHROME_SEL = 'header,nav,[class*="nav"],[class*="header"],[class*="topbar"],' +
                   '[class*="masthead"],[class*="util"],[class*="brand"]';

  function ours(el) {
    return !!(el.closest && (el.closest('#ladBrandBar') || el.closest('#ladFooter')));
  }

  function attrs(el, names) {
    var out = '';
    for (var i = 0; i < names.length; i++) out += ' ' + (el.getAttribute(names[i]) || '');
    return out;
  }

  // Returns a short reason string when the page already shows a mark,
  // or null when it does not. Any non-null answer suppresses the bar.
  function alreadyBranded() {
    var i, el, imgs = document.getElementsByTagName('img');

    // 1. The artwork itself, however it is referenced.
    var refs = document.querySelectorAll('img,source,image,use,object,embed');
    for (i = 0; i < refs.length; i++) {
      el = refs[i]; if (ours(el)) continue;
      if (ART_RE.test(attrs(el, ['src', 'srcset', 'data-src', 'href', 'xlink:href', 'data'])))
        return 'official artwork referenced on the page';
    }

    // 2. An element named for the lockup that actually carries artwork.
    //    The name alone proves nothing — the image has to be there, and a
    //    gradient is not an image, which is why only url() backgrounds
    //    count.
    var named = document.querySelectorAll('[class],[id]');
    for (i = 0; i < named.length; i++) {
      el = named[i]; if (ours(el)) continue;
      var nm = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
      var strong = NAME_RE.test(nm);
      if (!strong && !WEAK_NAME_RE.test(nm)) continue;
      if (el.querySelector(strong ? 'img,svg,picture,image' : 'img,picture'))
        return 'lockup element carrying artwork';
      var bg; try { bg = getComputedStyle(el).backgroundImage; } catch (e) { bg = ''; }
      if (bg && /url\(/i.test(bg)) return 'lockup element with a background image';
    }

    // 3. An image labelled as one of the two marks, wherever it is served
    //    from — covers local copies of the artwork under any filename.
    for (i = 0; i < imgs.length; i++) {
      el = imgs[i]; if (ours(el)) continue;
      if (ALT_RE.test(attrs(el, ['alt', 'aria-label', 'title'])))
        return 'image labelled as an official mark';
    }

    // 4. Structural backstop: the page's own header/nav across the top of
    //    the document carrying a real image asset of logo size. Only
    //    <img> counts. Inline <svg> is how every page here draws its
    //    icons — search glasses, chevrons, a generic shield — and reading
    //    those as a mark would take the bar off pages that carry no
    //    Government artwork at all.
    for (i = 0; i < imgs.length; i++) {
      el = imgs[i]; if (ours(el)) continue;
      if (!el.closest(CHROME_SEL)) continue;
      var r = el.getBoundingClientRect();
      if (r.top > 200) continue;                        // not part of the masthead
      var h = r.height || parseFloat(el.getAttribute('height')) || 0;
      if (h > 24) return 'own masthead image';          // taller than an icon
    }

    return null;
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

    // A page shown inside another LAD page (the CRM embeds the admin,
    // trainer and topic-builder screens in iframes, flagged ?embed=1 /
    // html.lad-embed) must not repeat the marks the host page already
    // carries — one identity per viewport. Bar and footer both stay off.
    if (window.self !== window.top ||
        document.documentElement.classList.contains('lad-embed')) {
      window.__ladBrandBarSkipped = 'embedded in another LAD page';
      return;
    }

    // Pages that print the marks themselves get nothing added, so nothing
    // is shifted either: makeRoom() is reachable only from inside this
    // branch, and scrollPaddingTop is only set when a bar exists to clear.
    var branded = alreadyBranded();
    if (branded) {
      window.__ladBrandBarSkipped = branded;
    } else {
      var bar = brandBar();
      document.body.insertBefore(bar, document.body.firstChild);

      // A body laid out as a horizontal flex row (the application shells:
      // rail + main) takes the bar as one more COLUMN, and the content
      // pane — flex:1 with min-width:0 — is starved to zero width: header,
      // rail, and a blank page. Wrap the row and give the bar a full line
      // of its own. A grid body (lawyer-portal-v2) has the same failure
      // mode and gets the grid version of the same cure.
      var pre = getComputedStyle(document.body);
      if (pre.display.indexOf('flex') !== -1 &&
          pre.flexDirection.indexOf('row') === 0) {
        document.body.style.flexWrap = 'wrap';
        bar.style.flex = '0 0 100%';
      } else if (pre.display.indexOf('grid') !== -1) {
        bar.style.gridColumn = '1 / -1';
      }
      // Pages that size their panes against the viewport can subtract
      // var(--lad-bar-h) behind this class — set only when a bar exists.
      document.body.classList.add('lad-has-brandbar');

      // Measure after insertion — the bar's height comes from the stylesheet,
      // and if the stylesheet failed to load there is nothing to make room for.
      var barH = bar.getBoundingClientRect().height;
      if (barH > 0) {
        makeRoom(barH);
        // Some pages clear their own fixed nav with a scroll-margin; keep
        // in-page anchors landing below both bars.
        html.style.scrollPaddingTop = barH + 'px';
      }
    }

    // A page that manages its own scrolling (a full-viewport application
    // shell) would hide a footer or break its layout. Those pages still
    // carry both marks — in the bar, or in their own masthead — which is
    // what the identity requires. Unchanged by the check above.
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
