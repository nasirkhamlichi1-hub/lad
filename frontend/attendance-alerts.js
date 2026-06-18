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

  // Rich-but-subtle palette — deep, desaturated accents on soft tinted
  // surfaces. No icons; the colour and serif headline carry the hierarchy.
  var TONE = {
    final:   { accent: '#6d2b48', bg: '#f8f2f5', label: 'Final day' },   // deep plum
    urgent:  { accent: '#8a4a2c', bg: '#f9f4ef', label: 'Urgent' },      // burnt sienna
    warning: { accent: '#7d6a2f', bg: '#f8f5ea', label: 'Reminder' },    // antique gold
    notice:  { accent: '#33506e', bg: '#f1f4f8', label: 'Due soon' }     // indigo slate
  };

  function style() {
    if (document.getElementById('aa-style')) return;
    var s = document.createElement('style');
    s.id = 'aa-style';
    s.textContent =
      '#aa-bar{position:sticky;top:0;z-index:9999;background:#fff;box-shadow:0 1px 0 rgba(15,23,42,.06)}' +
      '.aa-row{display:flex;align-items:center;gap:22px;padding:15px 30px;border-bottom:1px solid rgba(15,23,42,.05)}' +
      '.aa-lead{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}' +
      '.aa-tag{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9px;font-weight:600;letter-spacing:.22em;text-transform:uppercase}' +
      '.aa-head{font-family:"Cormorant Garamond","Crimson Pro",Georgia,serif;font-size:19px;font-weight:600;line-height:1.15;letter-spacing:.005em;color:#1a1a1a}' +
      '.aa-head .aa-code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;font-weight:500;color:#94a3b8;letter-spacing:.04em;margin-left:8px;vertical-align:1px}' +
      '.aa-meta{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#64748b;font-size:12px;line-height:1.45;letter-spacing:.005em}' +
      '.aa-cta{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:12px;font-weight:500;letter-spacing:.02em;cursor:pointer;white-space:nowrap;background:none;border:0;padding:0;border-bottom:1px solid transparent;transition:border-color .15s}' +
      '.aa-cta:hover{border-bottom-color:currentColor}' +
      '.aa-x{background:none;border:0;color:#cbd5e1;font-size:17px;cursor:pointer;padding:0 2px;line-height:1;transition:color .15s}' +
      '.aa-x:hover{color:#64748b}' +
      '.aa-more{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:11px;color:#94a3b8;padding:10px 30px;cursor:pointer;background:#fcfcfd;border:0;border-bottom:1px solid rgba(15,23,42,.05);width:100%;text-align:left;letter-spacing:.06em;text-transform:uppercase}' +
      '.aa-more:hover{color:#475569}';
    document.head.appendChild(s);
  }

  function row(a, audience) {
    var t = TONE[a.tone] || TONE.notice;
    var el = document.createElement('div');
    el.className = 'aa-row';
    el.style.background = t.bg;
    el.style.boxShadow = 'inset 3px 0 0 ' + t.accent;
    var who = (audience === 'lad' && a.firm) ? ' · ' + esc(a.firm) : '';
    var deadline = a.deadline ? new Date(a.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    el.innerHTML =
      '<span class="aa-lead">' +
        '<span class="aa-tag" style="color:' + t.accent + '">' + esc(t.label) + '</span>' +
        '<span class="aa-head">' + esc(a.courseTitle) + '<span class="aa-code">' + esc(a.code) + '</span></span>' +
        '<span class="aa-meta">' + esc(a.message) + (deadline ? ' · Deadline ' + deadline : '') + who + '</span>' +
      '</span>' +
      (audience === 'firm'
        ? '<button class="aa-cta" style="color:' + t.accent + '" data-code="' + esc(a.code) + '">File attendees</button>' : '') +
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
