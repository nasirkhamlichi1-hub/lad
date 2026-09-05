/* ═══════════════════════════════════════════════════════════════════════
 * lad-i18n.js — the Arabic interface, on every page
 * ═══════════════════════════════════════════════════════════════════════
 * Arabic is the Department's language of record; English is the parallel
 * version. This file makes the whole front end read in Arabic without
 * hand-editing thirty pages of markup and the JavaScript that renders most
 * of them: it sets the document direction before first paint, then
 * translates every visible string — text nodes, placeholders, titles,
 * aria-labels, alt text — against the dictionary in lad-ar.js, and keeps
 * doing so as pages render new content.
 *
 * How a string is matched, in order:
 *   1. the whole string, with runs of digits replaced by {0} {1} … so
 *      "3 lawyers · 2 firms" is one entry, not thousands;
 *   2. the same with trailing punctuation set aside;
 *   3. each part between " · ", " — ", " | " separately;
 *   4. the longest dictionary entry the string begins or ends with, so
 *      "Assigned by Nasir Khamlichi" keeps the name and translates the rest;
 *   5. a small token map for units, months and weekdays.
 * A string that matches nothing is left in English and listed in
 * window.__ladI18nMissing so the dictionary can be extended from real use.
 *
 * Numbers, ids, emails, times and anything inside <code>, <pre>, <script>,
 * or an element marked translate="no" are never touched. Course content the
 * Department authors is data, not interface, and is rendered as written.
 *
 * Load order: this file goes in <head> after runtime-config.js and before
 * anything that paints. It pulls lad-ar.js itself when Arabic is active.
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__ladI18n) return;
  window.__ladI18n = true;

  var KEY = 'lad_lang';
  var DEFAULT = 'ar';
  var html = document.documentElement;

  function readLang() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    if (q === 'ar' || q === 'en') {
      try { localStorage.setItem(KEY, q); } catch (e) {}
      return q;
    }
    try { var v = localStorage.getItem(KEY); if (v === 'ar' || v === 'en') return v; } catch (e) {}
    return DEFAULT;
  }

  var LANG = readLang();
  window.LAD_LANG = LANG;
  window.ladSetLang = function (l) {
    l = l === 'en' ? 'en' : 'ar';
    try { localStorage.setItem(KEY, l); } catch (e) {}
    // Propagate to any embedded LAD page (the CRM embeds five) — they read
    // the same localStorage on reload, so one reload of the top page is enough.
    location.reload();
  };

  html.setAttribute('lang', LANG);
  html.setAttribute('dir', LANG === 'ar' ? 'rtl' : 'ltr');
  html.classList.add('lad-lang-' + LANG);

  // ── The switch ────────────────────────────────────────────────────
  // Top of the page, where a language switch belongs — not floating over the
  // content. Each portal draws a horizontal bar of some kind across the top,
  // so the switch joins that bar and sits at its end (its inline-end, so it
  // mirrors in Arabic without a second rule). Where no bar has room for it —
  // a phone, mostly — it takes a row of its own directly beneath the chrome
  // rather than floating over the navigation.
  //
  // Top-level pages only. An embedded page follows the page that embeds it.
  function mountSwitch() {
    if (window.self !== window.top) return;
    if (/[?&]embed=1/.test(location.search)) return;
    if (document.getElementById('ladLangSwitch')) return;
    // A page that already prints its own language control keeps it. The public
    // portal puts العربية in its dark nav and routes it through ladSetLang, so
    // injecting a second control there gives a visitor two switches side by
    // side and no way to tell which one is authoritative.
    if (document.querySelector('.lad-nav-lang, [data-lad-lang-switch]')) return;
    var d = document.createElement('div');
    d.id = 'ladLangSwitch';
    d.className = 'lad-langswitch';
    d.setAttribute('translate', 'no');
    d.setAttribute('role', 'group');
    d.setAttribute('aria-label', 'Language / اللغة');
    d.innerHTML =
      '<button type="button" data-lang="ar" lang="ar"' + (LANG === 'ar' ? ' aria-current="true"' : '') + '>العربية</button>' +
      '<button type="button" data-lang="en" lang="en"' + (LANG === 'en' ? ' aria-current="true"' : '') + '>English</button>';
    d.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-lang]');
      if (!b) return;
      if (b.getAttribute('data-lang') === LANG) return;
      window.ladSetLang(b.getAttribute('data-lang'));
    });
    document.body.appendChild(d);
    place(d);

    // Placement depends on the width of a bar that is still settling when the
    // document is first ready: the Department's artwork loads late, and if it
    // cannot be reached the wider typographic lockup replaces it, which can
    // take away the room the switch was measured into. So place again once
    // everything has loaded, and again whenever the window is resized.
    //
    // Several of these pages also re-render their shell after they have their
    // data, which throws away anything inside it. Re-placing puts the switch
    // back, so a re-render cannot leave a page with no way to change language.
    function again() {
      if (!d.isConnected) document.body.appendChild(d);
      place(d);
    }
    window.addEventListener('load', again);
    var t = null;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(again, 150);
    });
    if (window.MutationObserver) {
      var pending = false;
      new MutationObserver(function () {
        if (pending || d.isConnected) return;
        pending = true;
        setTimeout(function () { pending = false; again(); }, 60);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  // Put the switch in the page's own top bar if one has room for it; failing
  // that, in a row of its own under the chrome; failing that — a body whose
  // own layout an extra child would disturb — in a fixed pill. Re-runnable: it
  // re-derives the answer from the page as it stands now and moves the node.
  //
  // Candidates are listed in one selector and taken in document order, which
  // is also the order we want: the Government utility strip sits above the
  // dark portal nav, which sits above the page's own .topbar, and the highest
  // bar on the page is the one a visitor reads as "the top".
  //
  // Matching the selector is not enough: lawyer-portal-v2 carries a .topbar
  // that is display:none at desktop widths, and appending to it hid the switch
  // completely. So a candidate has to actually be laid out — on screen, wide
  // enough to be a bar, and near the top — before it is adopted.
  //
  // Bare `nav` is deliberately NOT a candidate. It is tempting — on some pages
  // the top bar is a plain <nav> — but on these portals <nav> is just as often
  // the side rail (.sb-nav, .rail) or a secondary bar, and admitting it moved
  // the switch somewhere worse on clpd-portal while fixing nothing. A page
  // with no bar we recognise gets the fixed pill, which is predictable
  // everywhere.
  function place(d) {
    var bars = [];
    var cands = document.querySelectorAll(
      '.lad-util-inner, .lad-shared-nav, .topbar, .lad-brandbar, header.topbar');
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (el.contains(d)) continue;
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue; // display:none
      var r = el.getBoundingClientRect();
      // A horizontal bar across the top: it spans the screen, it is short, and
      // it is near the top. "Spans the screen" is measured against the
      // viewport, not a fixed 400px — on a phone every bar is under 400px wide
      // and an absolute floor left the switch floating over the masthead.
      if (r.width < Math.min(400, window.innerWidth * 0.8)) continue;
      if (r.height < 24 || r.height > 120 || r.top > 160) continue;
      bars.push(el);
    }
    // The bar the switch is already in still counts, and keeps its place ahead
    // of the rest so a re-run does not shuffle it between equally good bars.
    // Its own row is not a bar: counting it would make every re-run conclude
    // the switch already fits where it is and never move it back up.
    var current = d.parentElement;
    if (current && current !== document.body && current.id !== 'ladLangRow') bars.unshift(current);

    for (var k = 0; k < bars.length; k++) {
      var host = bars[k];
      d.style.removeProperty('--lad-sw-top');
      d.className = 'lad-langswitch lad-langswitch--inline'
        // The dark portal nav needs the light treatment; a white pill on navy
        // reads as a hole punched in the bar. Decide from the bar's own colour
        // rather than its class, so a page that restyles its bar still gets a
        // switch that matches it.
        + (isDark(host) ? ' lad-langswitch--ondark' : '');
      if (d.parentElement !== host) host.appendChild(d);
      // Does it actually fit? These bars are fixed-height flex rows carrying
      // the Department's marks, and on a narrow screen — or when the artwork
      // fails and the wider typographic lockup stands in — a third child
      // pushes past the edge and the switch ends up half off-screen. Measure
      // rather than guess. Nothing here may shrink the marks to make room.
      //
      // Compare the boxes rather than reading scrollWidth: a flex child that
      // overflows a bar with visible overflow does not always widen it.
      var hb = host.getBoundingClientRect(), sb = d.getBoundingClientRect();
      if (sb.width >= 1 && sb.right <= hb.right + 1 && sb.left >= hb.left - 1) {
        dropRow();
        return;
      }
    }

    // No bar has room — a phone, typically, where the masthead already fills
    // the width. Give the switch a row of its own directly under the chrome
    // instead of floating it: in normal flow it pushes the page down by 40px
    // and covers nothing, where a floating pill on a 390px screen lands on
    // the navigation every time.
    //
    // The row goes at body level, after the last bar that is itself a child of
    // body. Anchoring it inside a content area instead would work until the
    // page re-rendered that area, which several of these do once their data
    // arrives — and the switch would vanish with it.
    var anchor = null;
    for (var a = bars.length - 1; a >= 0; a--) {
      if (bars[a].parentElement === document.body) { anchor = bars[a]; break; }
    }
    var row = document.getElementById('ladLangRow');
    var bodyFlows = /^(block|flow-root)$/.test(getComputedStyle(document.body).display);
    if (bodyFlows) {
      if (!row) {
        row = document.createElement('div');
        row.id = 'ladLangRow';
        row.className = 'lad-langswitch-row';
      }
      d.className = 'lad-langswitch lad-langswitch--inline';
      d.style.removeProperty('--lad-sw-top');
      row.appendChild(d);
      // After the lowest bar, so the marks still lead the page. A bar that is
      // fixed or sticky is not in flow where it appears, but its DOM position
      // is still the right seam to insert at.
      if (anchor) {
        if (row.previousElementSibling !== anchor) document.body.insertBefore(row, anchor.nextSibling);
      } else if (row !== document.body.firstElementChild) {
        document.body.insertBefore(row, document.body.firstChild);
      }
      // The row keeps the white pill whatever is behind it. The dark treatment
      // is for a switch sitting *inside* a dark bar, where a white pill reads
      // as a hole; a white pill on open dark page background is just a
      // control, and reads the same way the floating pill always did.
      //
      // Anything else pinned to the top inline end — the notifications bell —
      // reads this so it can sit below the row instead of on top of it.
      document.documentElement.style.setProperty(
        '--lad-langrow-h', Math.round(row.getBoundingClientRect().height) + 'px');
      return;
    }

    // Body is a flex or grid container, where an extra child would join the
    // page's own layout and disturb it. Float instead, below the lowest bar.
    dropRow();
    d.className = 'lad-langswitch';
    if (d.parentElement !== document.body) document.body.appendChild(d);
    var floor = 0;
    for (var j = 0; j < bars.length; j++) {
      var br = bars[j].getBoundingClientRect();
      if (br.bottom > floor) floor = br.bottom;
    }
    if (floor > 0) d.style.setProperty('--lad-sw-top', Math.round(floor + 10) + 'px');
    else d.style.removeProperty('--lad-sw-top');
  }

  // The switch has gone back into a bar, so its own row is now an empty gap.
  function dropRow() {
    var row = document.getElementById('ladLangRow');
    if (row && row.parentElement) row.parentElement.removeChild(row);
    document.documentElement.style.setProperty('--lad-langrow-h', '0px');
  }

  // Is this element painted on a dark ground? Walks up until it finds an
  // ancestor that actually paints one, because a flex row inside a dark nav
  // is itself transparent.
  function isDark(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var m = getComputedStyle(n).backgroundColor
        .match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
      if (!m) continue;
      if (m[4] !== undefined && parseFloat(m[4]) < 0.5) continue; // see-through
      // Rec. 601 luma is good enough to tell navy from white.
      return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) < 128;
    }
    return false;
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  if (LANG !== 'ar') { onReady(mountSwitch); return; }

  // ── Arabic: hold the paint until the first pass has run ──────────
  // A flash of English on a page that then turns Arabic reads as broken.
  // The class is removed after the first pass, or after 1.5 s regardless,
  // so a dictionary that fails to load never leaves a blank page.
  html.classList.add('lad-i18n-pending');
  (function () {
    var st = document.createElement('style');
    st.id = 'ladI18nPendingStyle';
    st.textContent = 'html.lad-i18n-pending body{visibility:hidden}';
    (document.head || html).appendChild(st);
    setTimeout(release, 1500);
  })();
  function release() { html.classList.remove('lad-i18n-pending'); }

  // Dictionary: same origin, blocking when we are still parsing so it is
  // there before the first pass; appended otherwise.
  (function loadDict() {
    if (window.LAD_AR) return;
    var me = document.currentScript && document.currentScript.src;
    var base = me ? me.replace(/[^\/]*$/, '') : '';
    var src = base + 'lad-ar.js?v=' + (window.LAD_I18N_V || '1');
    if (document.readyState === 'loading') {
      document.write('<script src="' + src.replace(/"/g, '&quot;') + '" onerror="window.__ladArMissing=1"><\/script>');
    } else {
      var s = document.createElement('script'); s.src = src; s.async = false;
      s.onload = function () { buildIndex(); translateAll(); };
      s.onerror = function () { window.__ladArMissing = 1; fallbackToEnglish(); };
      (document.head || html).appendChild(s);
    }
  })();

  // No dictionary (blocked, missing, or a broken deploy): an Arabic frame
  // around English text is worse than English. Fall back for this page load
  // only — the choice is kept, and the next load tries again.
  var fellBack = false;
  function fallbackToEnglish() {
    if (fellBack) return; fellBack = true;
    html.setAttribute('lang', 'en'); html.setAttribute('dir', 'ltr');
    html.classList.remove('lad-lang-ar'); html.classList.add('lad-lang-en');
    release();
    try { console.warn('[lad-i18n] Arabic dictionary unavailable — showing English for this load.'); } catch (e) {}
  }

  // ── Matching ──────────────────────────────────────────────────────
  var D = null, LOWER = null, PREFIX = null, TOKENS = null;
  var NUM = /(^|[^A-Za-z؀-ۿ])([+\-]?\d[\d,.:]*)(?![A-Za-z]{2})/g; // a one-letter unit (30d, 10m, 14d+) is not part of the number
  var LATIN = /[A-Za-z]/;
  var ARABIC = /[؀-ۿ]/;
  var SEPS = [' · ', ' — ', ' | ', ' • ', ' – '];

  function buildIndex() {
    D = window.LAD_AR || {};
    TOKENS = window.LAD_AR_TOKENS || {};
    LOWER = {}; PREFIX = {};
    var k;
    for (k in D) {
      if (!Object.prototype.hasOwnProperty.call(D, k)) continue;
      var lk = k.toLowerCase();
      if (LOWER[lk] === undefined) LOWER[lk] = D[k];
      var fw = firstWord(lk);
      if (fw) (PREFIX[fw] = PREFIX[fw] || []).push(lk);
    }
    for (k in PREFIX) PREFIX[k].sort(function (a, b) { return b.length - a.length; });
  }
  function firstWord(s) { var m = /^[^\s]+/.exec(s); return m ? m[0] : ''; }

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function tpl(s) {
    var nums = [], i = 0;
    var k = s.replace(NUM, function (m, pre, num) { nums.push(num); return pre + '{' + (i++) + '}'; });
    return { k: k, nums: nums };
  }
  function fill(t, nums) {
    return t.replace(/\{(\d+)\}/g, function (_, i) { return nums[+i] !== undefined ? nums[+i] : ''; });
  }
  function lookup(k) {
    if (D[k] !== undefined) return D[k];
    var v = LOWER[k.toLowerCase()];
    return v === undefined ? null : v;
  }

  // Translate one normalised string. Returns null when nothing matched.
  function tx(n, depth) {
    depth = depth || 0;
    if (!n || !LATIN.test(n) || ARABIC.test(n)) return null;
    if (depth > 4) return null;
    var t = tpl(n), r = lookup(t.k);
    if (r !== null) return fill(r, t.nums);

    // Trailing / leading punctuation kept aside.
    var m = /^(.*?)([\s:.…!?→›»)\]]+)$/.exec(n);
    if (m && m[1] && m[1] !== n) { r = tx(m[1], depth + 1); if (r !== null) return r + mirrorArrow(m[2]); }
    m = /^([(\[«‹→✓✔✕×✦✨⚠☰↻⤓↓↑←…•·▸►◂◀\-–—+]+\s*)(.*)$/.exec(n);
    if (m && m[2] && m[2] !== n) { r = tx(m[2], depth + 1); if (r !== null) return mirrorArrow(m[1]) + r; }

    // Parts between separators.
    for (var i = 0; i < SEPS.length; i++) {
      if (n.indexOf(SEPS[i]) === -1) continue;
      var parts = n.split(SEPS[i]), any = false, out = [];
      for (var j = 0; j < parts.length; j++) {
        var p = tx(parts[j], depth + 1);
        if (p !== null) any = true;
        out.push(p !== null ? p : parts[j]);
      }
      if (any) return out.join(SEPS[i]);
    }

    // Longest dictionary entry the string starts with (word boundary). Only
    // multi-word entries qualify: a single word at the front of a title the
    // Department wrote ("Second package") is content, not interface.
    var lk = t.k.toLowerCase(), fw = firstWord(lk), cands = PREFIX[fw];
    if (cands) {
      for (i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (c.length >= lk.length || c.length < 3 || c.indexOf(' ') === -1) continue;
        if (lk.indexOf(c) !== 0) continue;
        var after = lk.charAt(c.length);
        if (/[A-Za-z0-9]/.test(after)) continue;
        var head = fill(LOWER[c], t.nums);
        var rest = n.slice(c.length);
        var rr = tx(rest, depth + 1);
        return head + (rr !== null ? rr : rest);
      }
    }
    // …or ends with.
    var words = lk.split(' ');
    for (i = 1; i < words.length - 1 && i < 12; i++) {   // the tail must be at least two words
      var tail = words.slice(i).join(' ');
      if (tail.length < 3) break;
      var tv = LOWER[tail];
      if (tv !== undefined) {
        var headStr = n.slice(0, n.length - tail.length);
        var hr = tx(headStr, depth + 1);
        return (hr !== null ? hr : headStr) + fill(tv, t.nums);
      }
    }

    // Token map: units, months, weekdays — only in strings that carry a
    // number ("12 pts", "4 Sep 2026"); a title without one is left alone.
    if (words.length <= 10 && /\d/.test(n)) {
      var changed = false;
      var outw = n.split(/(\s+)/).map(function (w) {
        if (!/\S/.test(w)) return w;
        var core = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
        if (!core) return w;
        var v = TOKENS[core] !== undefined ? TOKENS[core] : TOKENS[core.toLowerCase()];
        if (v === undefined) return w;
        changed = true;
        return w.replace(core, v);
      });
      if (changed) return outw.join('');
    }
    return null;
  }

  // Arrows point the other way in a right-to-left sentence.
  function mirrorArrow(s) {
    return s.replace(/[→←›‹»«▸◂►◀]/g, function (c) {
      return { '→': '←', '←': '→', '›': '‹', '‹': '›', '»': '«', '«': '»', '▸': '◂', '◂': '▸', '►': '◀', '◀': '►' }[c] || c;
    });
  }

  var missing = window.__ladI18nMissing = {};
  function translateText(s) {
    var n = norm(s);
    if (!n) return null;
    var r = tx(n, 0);
    if (r === null) { if (LATIN.test(n) && !ARABIC.test(n)) missing[tpl(n).k] = (missing[tpl(n).k] || 0) + 1; return null; }
    // keep the original's surrounding whitespace
    var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
    return lead + r + trail;
  }

  // ── Applying ──────────────────────────────────────────────────────
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1, SVG: 1, TEMPLATE: 1, KBD: 1, SAMP: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'data-tooltip'];
  var orig = new WeakMap();      // Text → what the page wrote
  var written = new WeakMap();   // Text → what we wrote
  var attrWritten = new WeakMap(); // Element → {attr: value we wrote}
  var mirrored = new WeakSet();

  function skipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP[e.nodeName]) return true;
      if (e.getAttribute('translate') === 'no') return true;
      if (e.id === 'ladLangSwitch') return true;
      if (e.classList && (e.classList.contains('notranslate') || e.classList.contains('lad-content'))) return true;
      if (e.isContentEditable) return true;
    }
    return false;
  }

  // A run of digit groups — "800 523", "+971 4 353 5555", "04/09/2026 · 13:00" —
  // has no letters for the bidi algorithm to anchor on, so in a right-to-left
  // paragraph its groups come out reversed. Isolate it as left-to-right.
  var NUMERIC_RUN = /^\s*[+(]?\d[\d\s().\-\/:]*\d\s*$/;
  function doNumeric(node) {
    var data = node.data;
    if (!NUMERIC_RUN.test(data) || !/\d[\s\-\/.]+\d/.test(data)) return;
    if (data.indexOf('\u2066') !== -1) return;
    var last = written.get(node);
    if (last !== undefined && last === data) return;
    var r = data.replace(/^(\s*)(.*?)(\s*)$/, '$1\u2066$2\u2069$3');
    written.set(node, r);
    node.data = r;
  }

  function doText(node) {
    var data = node.data;
    if (!data) return;
    if (!LATIN.test(data)) { doNumeric(node); return; }
    var last = written.get(node);
    if (last !== undefined && last === data) return;          // our own write
    if (!orig.has(node) || last !== data) orig.set(node, data);
    var r = translateText(orig.get(node));
    if (r === null || r === data) return;
    written.set(node, r);
    node.data = r;
  }

  function doAttrs(el) {
    var rec = attrWritten.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var v = el.getAttribute(a);
      if (rec && rec[a] === v) continue;
      var r = translateText(v);
      if (r === null || r === v) continue;
      if (!rec) { rec = {}; attrWritten.set(el, rec); }
      rec[a] = r;
      el.setAttribute(a, r);
    }
    if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '') && el.hasAttribute('value')) {
      var vv = el.getAttribute('value');
      if (!(rec && rec.value === vv)) {
        var rv = translateText(vv);
        if (rv !== null && rv !== vv) { if (!rec) { rec = {}; attrWritten.set(el, rec); } rec.value = rv; el.setAttribute('value', rv); }
      }
    }
  }

  // Inline styles written for left-to-right: flip the sided properties once.
  var SIDED = /\b(text-align|margin-left|margin-right|padding-left|padding-right|border-left|border-right|float|left|right|border-top-left-radius|border-top-right-radius|border-bottom-left-radius|border-bottom-right-radius)\s*:/;
  function mirrorStyle(el) {
    if (mirrored.has(el)) return;
    mirrored.add(el);
    var st = el.getAttribute('style');
    if (!st || !SIDED.test(st)) return;
    var out = st.replace(/(^|;)\s*([a-z\-]+)\s*:\s*([^;]+)/g, function (m, pre, prop, val) {
      var p = prop, v = val;
      if (p === 'text-align') { v = v === 'left' ? 'right' : v === 'right' ? 'left' : v; }
      else if (/^(margin|padding|border)-left$/.test(p)) p = p.replace('-left', '-right');
      else if (/^(margin|padding|border)-right$/.test(p)) p = p.replace('-right', '-left');
      else if (p === 'float') { v = v.trim() === 'left' ? 'right' : v.trim() === 'right' ? 'left' : v; }
      else if (p === 'left' && !/auto/.test(v) && /position\s*:\s*(absolute|fixed)/.test(st)) p = 'right';
      else if (p === 'right' && !/auto/.test(v) && /position\s*:\s*(absolute|fixed)/.test(st)) p = 'left';
      else if (/^border-(top|bottom)-(left|right)-radius$/.test(p)) p = p.replace(/-left-/, '-LEFT-').replace(/-right-/, '-left-').replace(/-LEFT-/, '-right-');
      return pre + p + ':' + v;
    });
    if (out !== st) el.setAttribute('style', out);
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skipped(root.parentNode)) doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (skipped(root)) return;
      doAttrs(root); mirrorStyle(root);
    }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) {
          if (SKIP[n.nodeName] || n.getAttribute('translate') === 'no' || n.id === 'ladLangSwitch' ||
              (n.classList && (n.classList.contains('notranslate') || n.classList.contains('lad-content'))) || n.isContentEditable) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else { doAttrs(n); mirrorStyle(n); }
    }
  }

  function translateTitle() {
    var t = document.title;
    if (!t) return;
    var r = translateText(t);
    if (r !== null && r !== t) document.title = r;
  }

  var ran = false;
  function translateAll() {
    if (!D) { if (window.LAD_AR) buildIndex(); else { if (window.__ladArMissing || document.readyState !== 'loading') fallbackToEnglish(); return; } }
    walk(document.body || document.documentElement);
    translateTitle();
    ran = true;
    release();
  }

  // ── Keeping up with the page ──────────────────────────────────────
  var queue = [], scheduled = false;
  function flush() {
    scheduled = false;
    var q = queue; queue = [];
    if (!D) { if (window.LAD_AR) buildIndex(); else return; }
    for (var i = 0; i < q.length; i++) {
      var m = q[i];
      if (m.type === 'characterData') { if (!skipped(m.target.parentNode)) doText(m.target); }
      else if (m.type === 'attributes') { if (!skipped(m.target)) doAttrs(m.target); }
      else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
    }
    if (q.length) translateTitle();
  }
  function observe() {
    var mo = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) queue.push(ms[i]);
      if (!scheduled) { scheduled = true; (window.requestAnimationFrame || setTimeout)(flush); }
    });
    mo.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS.concat(['value'])
    });
  }

  onReady(function () {
    translateAll();
    observe();
    mountSwitch();
    // Fonts and late scripts can repaint after us; one more pass catches
    // anything written synchronously during load.
    setTimeout(translateAll, 0);
  });

  // For pages that render into a detached fragment then insert it, and for
  // the harvest tooling: translate on demand.
  window.ladTranslate = function (root) { if (!D) buildIndex(); walk(root || document.body); };
  window.ladTx = function (s) { if (!D) buildIndex(); return translateText(s); };
})();
