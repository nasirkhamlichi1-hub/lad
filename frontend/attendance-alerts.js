/* attendance-alerts.js — shared attendance-filing deadline banner.
 *
 * When an internal session is accredited, the firm has 30 days to file its
 * attendees. This widget surfaces the escalating reminders (day 20 / 25 / 29
 * and a FINAL alert on day 30) at the TOP of the firm, training-provider and
 * LAD pages. The matching emails are sent server-side; this only renders the
 * on-page alert. Include it on a page with:
 *   <script src="attendance-alerts.js" data-aa-audience="firm"></script>
 * audience is informational only — the backend resolves scope from the token.
 */
(function () {
  'use strict';
  function base() {
    return (window.LAD_API_BASE)
      || (window.LAD_SYNC && window.LAD_SYNC.base)
      || 'https://lad-clpd-backend.onrender.com';
  }
  function token() { try { return localStorage.getItem('lad_token') || ''; } catch (_) { return ''; } }

  var TONE = {
    final:   { bg: '#7f1d1d', bar: '#ef4444', ico: '⛔', label: 'FINAL DAY' },
    urgent:  { bg: '#9a3412', bar: '#f97316', ico: '⏰', label: 'URGENT' },
    warning: { bg: '#854d0e', bar: '#eab308', ico: '⚠️', label: 'REMINDER' },
    notice:  { bg: '#1e3a5f', bar: '#3b82f6', ico: '🔔', label: 'DUE' }
  };

  function style() {
    if (document.getElementById('aa-style')) return;
    var s = document.createElement('style');
    s.id = 'aa-style';
    s.textContent =
      '#aa-bar{position:sticky;top:0;z-index:9999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '.aa-row{display:flex;align-items:center;gap:14px;padding:11px 20px;color:#fff;border-bottom:1px solid rgba(255,255,255,.12)}' +
      '.aa-ico{font-size:18px;line-height:1}' +
      '.aa-tag{font-size:10px;font-weight:800;letter-spacing:.08em;padding:3px 8px;border-radius:5px;background:rgba(0,0,0,.28);white-space:nowrap}' +
      '.aa-txt{font-size:13px;line-height:1.35;flex:1;min-width:0}' +
      '.aa-txt b{font-weight:700}' +
      '.aa-meta{opacity:.85;font-size:12px}' +
      '.aa-cta{font-size:12px;font-weight:700;color:#fff;text-decoration:underline;cursor:pointer;white-space:nowrap;background:none;border:0}' +
      '.aa-x{background:none;border:0;color:rgba(255,255,255,.7);font-size:16px;cursor:pointer;padding:0 4px;line-height:1}' +
      '.aa-more{font-size:11.5px;opacity:.85;padding:5px 20px;color:#fff;cursor:pointer;background:rgba(0,0,0,.18);border:0;width:100%;text-align:left}';
    document.head.appendChild(s);
  }

  function row(a, audience) {
    var t = TONE[a.tone] || TONE.notice;
    var el = document.createElement('div');
    el.className = 'aa-row';
    el.style.background = t.bg;
    el.style.borderLeft = '5px solid ' + t.bar;
    var who = audience === 'lad'
      ? (a.firm ? '<span class="aa-meta"> — ' + esc(a.firm) + '</span>' : '')
      : '';
    var deadline = a.deadline ? new Date(a.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    el.innerHTML =
      '<span class="aa-ico">' + t.ico + '</span>' +
      '<span class="aa-tag">' + t.label + '</span>' +
      '<span class="aa-txt"><b>' + esc(a.title) + '</b> · ' + esc(a.courseTitle) + ' (' + esc(a.code) + ')' + who +
        '<br><span class="aa-meta">' + esc(a.message) +
        (deadline ? ' · Deadline ' + deadline : '') + '</span></span>' +
      (audience === 'firm' || audience === 'provider'
        ? '<button class="aa-cta" data-code="' + esc(a.code) + '">File attendees →</button>' : '') +
      '<button class="aa-x" title="Dismiss">×</button>';
    el.querySelector('.aa-x').onclick = function () { el.remove(); };
    var cta = el.querySelector('.aa-cta');
    if (cta) cta.onclick = function () { fileAttendees(a.code); };
    return el;
  }

  function fileAttendees(code) {
    // Hook into the page's own filing flow if present, else point the user there.
    if (typeof window.openAttendanceFiling === 'function') return window.openAttendanceFiling(code);
    if (typeof window.openSessionByCode === 'function') return window.openSessionByCode(code);
    alert('Open the session "' + code + '" and use “Record attendance” to file attendees.');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function render(alerts, audience) {
    var old = document.getElementById('aa-bar');
    if (old) old.remove();
    if (!alerts || !alerts.length) return;
    style();
    var bar = document.createElement('div');
    bar.id = 'aa-bar';
    var shown = alerts.slice(0, 3);
    shown.forEach(function (a) { bar.appendChild(row(a, audience)); });
    if (alerts.length > shown.length) {
      var more = document.createElement('button');
      more.className = 'aa-more';
      var n = alerts.length - shown.length;
      more.textContent = '+ ' + n + ' more session' + (n === 1 ? '' : 's') + ' awaiting attendance filing';
      more.onclick = function () { bar.querySelectorAll('.aa-more').forEach(function (m) { m.remove(); }); alerts.slice(shown.length).forEach(function (a) { bar.appendChild(row(a, audience)); }); };
      bar.appendChild(more);
    }
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function load() {
    var script = document.currentScript || document.querySelector('script[data-aa-audience]');
    var audience = (script && script.getAttribute('data-aa-audience')) || 'firm';
    var tk = token();
    if (!tk) return;
    var url = base() + '/api/v1/accreditations/alerts';
    var prov = window.__PROVIDER_NAME__;
    if (audience === 'provider' && prov) url += '?provider=' + encodeURIComponent(prov);
    fetch(url, { headers: { Authorization: 'Bearer ' + tk }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.alerts) render(d.alerts, audience); })
      .catch(function () { /* silent — cold start / offline */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  // Refresh every 5 min so milestones roll over without a reload.
  setInterval(load, 300000);
  window.__attendanceAlertsReload = load;
})();
