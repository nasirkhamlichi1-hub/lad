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
  // Premium, restrained palette — soft tinted surfaces with a fine colour
  // accent rather than full-bleed saturated bars. Icons are clean line SVGs.
  var TONE = {
    final:   { accent: '#a83a3a', bg: '#fbf4f3', ring: '#f1dedd', label: 'Final day', ic: 'octagon' },
    urgent:  { accent: '#b06a33', bg: '#fbf6f0', ring: '#f0e3d4', label: 'Urgent',    ic: 'clock' },
    warning: { accent: '#8f7430', bg: '#faf7ec', ring: '#ece3c9', label: 'Reminder',  ic: 'bell' },
    notice:  { accent: '#3c6491', bg: '#f2f5fa', ring: '#dde6f1', label: 'Due soon',  ic: 'calendar' }
  };
  var ICONS = {
    octagon:  '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"/><line x1="12" y1="8" x2="12" y2="12.5"/><circle cx="12" cy="16.2" r="0.6" fill="currentColor" stroke="none"/>',
    clock:    '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
    bell:     '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="2.5" x2="8" y2="6"/><line x1="16" y1="2.5" x2="16" y2="6"/>'
  };
  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.calendar) + '</svg>';
  }

  function style() {
    if (document.getElementById('aa-style')) return;
    var s = document.createElement('style');
    s.id = 'aa-style';
    s.textContent =
      '#aa-bar{position:sticky;top:0;z-index:9999;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 1px 0 rgba(15,23,42,.06)}' +
      '.aa-row{display:flex;align-items:center;gap:14px;padding:13px 24px;border-bottom:1px solid rgba(15,23,42,.06)}' +
      '.aa-ic{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;flex-shrink:0}' +
      '.aa-ic svg{width:17px;height:17px;display:block}' +
      '.aa-tag{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;white-space:nowrap}' +
      '.aa-txt{font-size:13px;line-height:1.45;flex:1;min-width:0;color:#1f2937}' +
      '.aa-txt b{font-weight:600;color:#0f172a}' +
      '.aa-meta{color:#64748b;font-size:12px}' +
      '.aa-cta{font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;background:none;border:0;padding:0}' +
      '.aa-cta:hover{text-decoration:underline}' +
      '.aa-x{background:none;border:0;color:#cbd5e1;font-size:18px;cursor:pointer;padding:0 2px;line-height:1;transition:color .15s}' +
      '.aa-x:hover{color:#64748b}' +
      '.aa-more{font-size:11.5px;color:#64748b;padding:9px 24px;cursor:pointer;background:#fafbfc;border:0;border-bottom:1px solid rgba(15,23,42,.06);width:100%;text-align:left;letter-spacing:.01em}' +
      '.aa-more:hover{color:#0f172a}';
    document.head.appendChild(s);
  }

  function row(a, audience) {
    var t = TONE[a.tone] || TONE.notice;
    var el = document.createElement('div');
    el.className = 'aa-row';
    el.style.background = t.bg;
    el.style.boxShadow = 'inset 3px 0 0 ' + t.accent;
    var who = audience === 'lad'
      ? (a.firm ? '<span class="aa-meta"> · ' + esc(a.firm) + '</span>' : '')
      : '';
    var deadline = a.deadline ? new Date(a.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    el.innerHTML =
      '<span class="aa-ic" style="background:' + t.ring + ';color:' + t.accent + '">' + svg(t.ic) + '</span>' +
      '<span class="aa-tag" style="color:' + t.accent + '">' + t.label + '</span>' +
      '<span class="aa-txt"><b>' + esc(a.title) + '</b> · ' + esc(a.courseTitle) + ' <span class="aa-meta">(' + esc(a.code) + ')</span>' + who +
        '<br><span class="aa-meta">' + esc(a.message) +
        (deadline ? ' · Deadline ' + deadline : '') + '</span></span>' +
      (audience === 'firm' || audience === 'provider'
        ? '<button class="aa-cta" style="color:' + t.accent + '" data-code="' + esc(a.code) + '">File attendees →</button>' : '') +
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
