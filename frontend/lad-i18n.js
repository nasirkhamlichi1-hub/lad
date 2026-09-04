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
  // A small fixed pill, bottom start corner, on top-level pages only. An
  // embedded page follows the page that embeds it.
  function mountSwitch() {
    if (window.self !== window.top) return;
    if (/[?&]embed=1/.test(location.search)) return;
    if (document.getElementById('ladLangSwitch')) return;
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
