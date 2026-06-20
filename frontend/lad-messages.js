/* ─────────────────────────────────────────────────────────────────────
 * lad-messages.js — drop-in messaging widget for the CLPD platform.
 *
 * One self-contained module, included in every portal. It adapts to the
 * signed-in user:
 *   • lawyers & firms  → a "Messages" launcher, their own threads, and a
 *                        composer to start a new conversation with CLPD Admin.
 *   • CLPD admins      → the full inbox: queue with All / Unassigned / Mine
 *                        filters, assignment to an admin on duty, status, reply.
 *
 * Talks only to /api/v1/messages/*. No dependencies. Safe to include twice.
 * Hidden entirely when there is no auth token.
 * ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (window.__ladMsgInit) return; window.__ladMsgInit = true;

  function base() {
    return (window.LAD_API_BASE || (window.LAD_SYNC && window.LAD_SYNC.base) || 'https://lad-clpd-backend.onrender.com').replace(/\/$/, '');
  }
  function token() { try { return localStorage.getItem('lad_token') || ''; } catch (_) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function ago(iso) {
    if (!iso) return ''; const t = Date.parse(String(iso).replace(' ', 'T')); if (isNaN(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
    const d = Math.floor(s / 86400); if (d < 30) return d + 'd'; if (d < 365) return Math.floor(d / 30) + 'mo'; return Math.floor(d / 365) + 'y';
  }
  async function api(path, opts) {
    const r = await fetch(base() + '/api/v1/messages' + path, Object.assign({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
    }, opts || {}));
    if (!r.ok) { let e = {}; try { e = await r.json(); } catch (_) {} throw new Error(e.error || ('HTTP ' + r.status)); }
    return r.json();
  }

  const ST = { open: false, admin: false, box: 'all', convs: [], active: null, admins: [], poll: null, composing: false };

  // ─── Styles ─────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('ladMsgCSS')) return;
    const css = `
    #ladMsgBtn{position:fixed;right:20px;bottom:20px;z-index:99998;background:#0d7377;color:#fff;border:none;border-radius:30px;padding:12px 18px;font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 22px rgba(13,115,119,.45);cursor:pointer;display:flex;align-items:center;gap:8px}
    #ladMsgBtn:hover{background:#0a5d61}
    #ladMsgBtn .ladmsg-badge{background:#ff4d6d;color:#fff;border-radius:10px;min-width:18px;height:18px;padding:0 5px;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center}
    #ladMsgBtn .ladmsg-badge.on{display:flex}
    @keyframes ladmsgPulse{0%,100%{box-shadow:0 6px 22px rgba(13,115,119,.45)}50%{box-shadow:0 6px 22px rgba(255,77,109,.55),0 0 0 5px rgba(255,77,109,.22)}}
    #ladMsgBtn.has-unread{animation:ladmsgPulse 1.7s ease-in-out infinite}
    #ladMsgBtn.has-unread .ladmsg-badge{animation:ladmsgPulse 1.7s ease-in-out infinite}
    #ladMsgPanel{position:fixed;right:0;top:0;height:100vh;width:420px;max-width:100vw;background:#0f1626;color:#e7ecf5;z-index:99999;box-shadow:-8px 0 40px rgba(0,0,0,.5);transform:translateX(102%);transition:transform .26s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}
    #ladMsgPanel.on{transform:translateX(0)}
    .ladmsg-hd{padding:15px 18px;border-bottom:1px solid #232c40;display:flex;align-items:center;gap:10px;flex-shrink:0}
    .ladmsg-hd h3{margin:0;font-size:15px;font-weight:700;flex:1}
    .ladmsg-x{background:none;border:none;color:#9aa6bf;font-size:22px;cursor:pointer;line-height:1}
    .ladmsg-back{background:none;border:none;color:#5fd0c8;cursor:pointer;font-size:13px;padding:0;display:flex;align-items:center;gap:4px}
    .ladmsg-filters{display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid #232c40;flex-shrink:0}
    .ladmsg-filters button{background:#1a2336;border:1px solid #2b364f;color:#aeb9d4;border-radius:14px;padding:4px 12px;font-size:12px;cursor:pointer;font-family:inherit}
    .ladmsg-filters button.on{background:#0d7377;border-color:#0d7377;color:#fff}
    .ladmsg-body{flex:1;overflow-y:auto;padding:8px 0}
    .ladmsg-row{padding:12px 18px;border-bottom:1px solid #1b2336;cursor:pointer}
    .ladmsg-row:hover{background:#161f33}
    .ladmsg-row.unread .ladmsg-row-subj{font-weight:700}
    .ladmsg-row-top{display:flex;align-items:center;gap:8px;margin-bottom:3px}
    .ladmsg-row-subj{flex:1;font-size:13.5px;color:#eef2fa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ladmsg-dot{width:8px;height:8px;border-radius:50%;background:#ff4d6d;flex-shrink:0}
    .ladmsg-time{font-size:11px;color:#6b7794;font-family:monospace;flex-shrink:0}
    .ladmsg-prev{font-size:12px;color:#8b97b0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ladmsg-pill{font-size:9.5px;font-weight:700;letter-spacing:.4px;padding:2px 7px;border-radius:6px;text-transform:uppercase}
    .ladmsg-pill.open{background:rgba(255,184,77,.18);color:#ffb84d}
    .ladmsg-pill.pending{background:rgba(95,208,200,.16);color:#5fd0c8}
    .ladmsg-pill.resolved,.ladmsg-pill.closed{background:rgba(61,240,160,.16);color:#3df0a0}
    .ladmsg-meta{font-size:11px;color:#6b7794}
    .ladmsg-thread{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
    .ladmsg-msg{max-width:82%;padding:9px 13px;border-radius:13px;font-size:13.5px;line-height:1.45}
    .ladmsg-msg.them{background:#1c2740;align-self:flex-start;border-bottom-left-radius:4px}
    .ladmsg-msg.me{background:#0d7377;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
    .ladmsg-msg .ladmsg-who{font-size:10.5px;opacity:.7;margin-bottom:3px}
    .ladmsg-compose{border-top:1px solid #232c40;padding:10px 14px;flex-shrink:0;background:#0f1626}
    .ladmsg-compose textarea,.ladmsg-compose input{width:100%;background:#1a2336;border:1px solid #2b364f;color:#eef2fa;border-radius:9px;padding:9px 11px;font:13.5px/1.4 inherit;resize:none;box-sizing:border-box}
    .ladmsg-compose .row{display:flex;gap:8px;margin-top:8px;align-items:center}
    .ladmsg-send{background:#0d7377;border:none;color:#fff;border-radius:9px;padding:9px 16px;font-weight:600;cursor:pointer;font-family:inherit}
    .ladmsg-send:disabled{opacity:.5;cursor:default}
    .ladmsg-empty{text-align:center;color:#6b7794;padding:40px 24px;font-size:13px}
    .ladmsg-sat{border-top:1px solid #232c40;padding:12px 14px;flex-shrink:0;background:#111a2c;text-align:center}
    .ladmsg-sat-q{font-size:12.5px;color:#c7d2e6;margin-bottom:9px}
    .ladmsg-sat-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
    .ladmsg-sat-yes,.ladmsg-sat-no{border:1px solid #2c3a55;background:#1a2740;color:#e7ecf5;border-radius:9px;padding:8px 14px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
    .ladmsg-sat-yes{background:#0d7377;border-color:#0d7377;color:#fff}
    .ladmsg-sat-yes:hover{background:#0a5d61}.ladmsg-sat-no:hover{border-color:#5fd0c8;color:#fff}
    .ladmsg-stars{display:flex;gap:4px;justify-content:center}
    .ladmsg-star{background:none;border:none;font-size:30px;line-height:1;color:#33405c;cursor:pointer;padding:0 2px;transition:color .1s}
    .ladmsg-star.on,.ladmsg-star:hover{color:#f5b301}
    .ladmsg-sat-thanks{font-size:13px;color:#5fd0c8;font-weight:600;padding:4px 0}
    .ladmsg-assign{display:flex;gap:6px;align-items:center;padding:9px 16px;border-bottom:1px solid #232c40;background:#131c2e;flex-wrap:wrap}
    .ladmsg-assign select{background:#1a2336;border:1px solid #2b364f;color:#eef2fa;border-radius:7px;padding:5px 8px;font-size:12px;font-family:inherit}
    .ladmsg-newbtn{background:#0d7377;border:none;color:#fff;border-radius:8px;padding:7px 13px;font-weight:600;cursor:pointer;font-size:12.5px;font-family:inherit}
    `;
    const s = document.createElement('style'); s.id = 'ladMsgCSS'; s.textContent = css; document.head.appendChild(s);
  }

  // ─── Launcher + panel skeleton ──────────────────────────────────────
  function mount() {
    injectCSS();
    if (document.getElementById('ladMsgBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'ladMsgBtn';
    btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Messages</span><span class="ladmsg-badge" id="ladMsgBadge">0</span>';
    btn.onclick = openPanel;
    document.body.appendChild(btn);
    const panel = document.createElement('div');
    panel.id = 'ladMsgPanel';
    panel.innerHTML = '<div id="ladMsgInner"></div>';
    document.body.appendChild(panel);
  }

  // ─── Unread badge polling ───────────────────────────────────────────
  async function refreshBadge() {
    try {
      const j = await api('/unread');
      const b = document.getElementById('ladMsgBadge');
      if (b) { b.textContent = j.unread > 99 ? '99+' : j.unread; b.classList.toggle('on', j.unread > 0); }
      var btn = document.getElementById('ladMsgBtn'); if (btn) btn.classList.toggle('has-unread', j.unread > 0);
      try { document.title = (j.unread > 0 ? '(' + j.unread + ') ' : '') + document.title.replace(/^\(\d+\)\s*/, ''); } catch (_) {}
    } catch (_) {}
  }

  function openPanel() { ST.open = true; document.getElementById('ladMsgPanel').classList.add('on'); loadList(); }
  function closePanel() { ST.open = false; document.getElementById('ladMsgPanel').classList.remove('on'); ST.active = null; if (ST.poll) { clearInterval(ST.poll); ST.poll = null; } refreshBadge(); }

  // ─── Conversation list ──────────────────────────────────────────────
  async function loadList() {
    ST.active = null; ST.composing = false;
    if (ST.poll) { clearInterval(ST.poll); ST.poll = null; }
    const inner = document.getElementById('ladMsgInner');
    inner.innerHTML = '<div class="ladmsg-hd"><h3>Messages</h3><button class="ladmsg-x" id="ladMsgClose">×</button></div><div class="ladmsg-body"><div class="ladmsg-empty">Loading…</div></div>';
    document.getElementById('ladMsgClose').onclick = closePanel;
    try {
      const q = ST.admin ? ('?box=' + ST.box) : '';
      const j = await api('/conversations' + q);
      ST.admin = !!j.admin; ST.convs = j.conversations || [];
      renderList();
    } catch (e) {
      inner.querySelector('.ladmsg-body').innerHTML = '<div class="ladmsg-empty">Couldn\'t load messages.<br>' + esc(e.message) + '</div>';
    }
    refreshBadge();
  }

  function renderList() {
    const inner = document.getElementById('ladMsgInner');
    const filters = ST.admin
      ? `<div class="ladmsg-filters">
           <button data-box="all" class="${ST.box === 'all' ? 'on' : ''}">All</button>
           <button data-box="unassigned" class="${ST.box === 'unassigned' ? 'on' : ''}">Unassigned</button>
           <button data-box="mine" class="${ST.box === 'mine' ? 'on' : ''}">Mine</button>
         </div>` : '';
    const newBtn = ST.admin ? '' : '<button class="ladmsg-newbtn" id="ladMsgNew">+ New message</button>';
    const rows = ST.convs.length ? ST.convs.map(c => `
      <div class="ladmsg-row ${c.unread ? 'unread' : ''}" data-id="${c.id}">
        <div class="ladmsg-row-top">
          ${c.unread ? '<span class="ladmsg-dot"></span>' : ''}
          <span class="ladmsg-row-subj">${esc(c.subject || '(no subject)')}</span>
          <span class="ladmsg-time">${ago(c.last_message_at)}</span>
        </div>
        <div class="ladmsg-prev">${esc(c.preview || '')}</div>
        <div class="ladmsg-row-top" style="margin-top:5px">
          <span class="ladmsg-pill ${c.status}">${esc(c.status)}</span>
          ${ST.admin && c.priority === 'high' ? '<span class="ladmsg-pill" style="background:rgba(255,77,109,.22);color:#ff8a9e">high</span>' : ''}
          ${ST.admin && c.category ? '<span class="ladmsg-pill" style="background:rgba(120,150,210,.18);color:#9fb4dc">' + esc(c.category) + '</span>' : ''}
          ${ST.admin && c.escalated ? '<span class="ladmsg-pill" style="background:rgba(255,77,109,.18);color:#ff7a93">needs human</span>' : (ST.admin && c.ai_handled ? '<span class="ladmsg-pill" style="background:rgba(95,208,200,.16);color:#5fd0c8">Maryam</span>' : '')}
          ${ST.admin ? `<span class="ladmsg-meta">${esc(c.requester_name || '')}${c.assigned_name ? ' · → ' + esc(c.assigned_name) : ''}</span>` : (c.assigned_name ? `<span class="ladmsg-meta">CLPD · ${esc(c.assigned_name)}</span>` : '<span class="ladmsg-meta">CLPD Admin</span>')}
        </div>
      </div>`).join('') : `<div class="ladmsg-empty">${ST.admin ? 'No conversations in this view.' : 'No messages yet.<br>Start a conversation with CLPD Admin.'}</div>`;
    inner.innerHTML = `<div class="ladmsg-hd"><h3>Messages</h3>${newBtn}<button class="ladmsg-x" id="ladMsgClose">×</button></div>${filters}<div class="ladmsg-body">${rows}</div>`;
    document.getElementById('ladMsgClose').onclick = closePanel;
    const nb = document.getElementById('ladMsgNew'); if (nb) nb.onclick = startCompose;
    inner.querySelectorAll('.ladmsg-filters button').forEach(b => b.onclick = () => { ST.box = b.getAttribute('data-box'); loadList(); });
    inner.querySelectorAll('.ladmsg-row').forEach(r => r.onclick = () => openThread(r.getAttribute('data-id')));
  }

  // ─── Compose a new conversation (requester only) ────────────────────
  function startCompose() {
    ST.composing = true;
    const inner = document.getElementById('ladMsgInner');
    inner.innerHTML = `
      <div class="ladmsg-hd"><button class="ladmsg-back" id="ladMsgBack">‹ Back</button><h3 style="flex:1;text-align:center">New message</h3><button class="ladmsg-x" id="ladMsgClose">×</button></div>
      <div class="ladmsg-body" style="padding:16px">
        <div class="ladmsg-meta" style="margin-bottom:10px">To: CLPD Admin</div>
        <input id="ladMsgSubj" placeholder="Subject" style="background:#1a2336;border:1px solid #2b364f;color:#eef2fa;border-radius:9px;padding:10px 12px;width:100%;box-sizing:border-box;font:13.5px inherit;margin-bottom:10px"/>
        <textarea id="ladMsgText" placeholder="Write your message…" rows="7" style="background:#1a2336;border:1px solid #2b364f;color:#eef2fa;border-radius:9px;padding:10px 12px;width:100%;box-sizing:border-box;font:13.5px/1.5 inherit;resize:vertical"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="ladmsg-send" id="ladMsgCreate">Send to CLPD</button></div>
      </div>`;
    document.getElementById('ladMsgClose').onclick = closePanel;
    document.getElementById('ladMsgBack').onclick = loadList;
    document.getElementById('ladMsgCreate').onclick = async () => {
      const subject = (document.getElementById('ladMsgSubj').value || '').trim();
      const body = (document.getElementById('ladMsgText').value || '').trim();
      if (!body) { document.getElementById('ladMsgText').focus(); return; }
      const btn = document.getElementById('ladMsgCreate'); btn.disabled = true; btn.textContent = 'Sending…';
      try { const j = await api('/conversations', { method: 'POST', body: JSON.stringify({ subject, body }) }); await loadList(); if (j.id) openThread(j.id); }
      catch (e) { btn.disabled = false; btn.textContent = 'Send to CLPD'; alert(e.message); }
    };
  }

  // ─── A single thread ────────────────────────────────────────────────
  async function openThread(id) {
    ST.active = id;
    const inner = document.getElementById('ladMsgInner');
    inner.innerHTML = '<div class="ladmsg-hd"><button class="ladmsg-back" id="ladMsgBack">‹ Back</button><h3 style="flex:1;text-align:center">Conversation</h3><button class="ladmsg-x" id="ladMsgClose">×</button></div><div class="ladmsg-thread"><div class="ladmsg-empty">Loading…</div></div>';
    document.getElementById('ladMsgClose').onclick = closePanel;
    document.getElementById('ladMsgBack').onclick = loadList;
    if (ST.admin && !ST.admins.length) { try { ST.admins = (await api('/admins')).admins || []; } catch (_) {} }
    await renderThread();
    if (ST.poll) clearInterval(ST.poll);
    ST.poll = setInterval(() => { if (ST.active === id && ST.open) renderThread(true); }, 12000);
  }

  async function renderThread(silent) {
    const id = ST.active; if (!id) return;
    let c; try { c = (await api('/conversations/' + id)).conversation; } catch (e) { if (!silent) { const t = document.querySelector('#ladMsgInner .ladmsg-thread'); if (t) t.innerHTML = '<div class="ladmsg-empty">' + esc(e.message) + '</div>'; } return; }
    if (ST.active !== id) return;
    const inner = document.getElementById('ladMsgInner');
    const assignBar = ST.admin ? `
      <div class="ladmsg-assign">
        <span class="ladmsg-meta">${esc(c.requester_name || '')} · ${esc(c.requester_type || '')}</span>
        <span style="flex:1"></span>
        <select id="ladMsgAssign">
          <option value="">Unassigned</option>
          ${ST.admins.map(a => `<option value="${a.id}" ${c.assigned_to === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
        <select id="ladMsgStatus">
          ${['open', 'pending', 'resolved', 'closed'].map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>` : '';
    const msgs = (c.messages || []).map(m => {
      const mine = ST.admin ? m.sender_side === 'admin' : m.sender_side === 'requester';
      return `<div class="ladmsg-msg ${mine ? 'me' : 'them'}"><div class="ladmsg-who">${esc(m.sender_name || (m.sender_side === 'admin' ? 'CLPD Admin' : 'You'))} · ${ago(m.created_at)}</div>${esc(m.body)}</div>`;
    }).join('');
    // Every conversation ends in a happiness rating; if Maryam couldn't help,
    // one click brings in a human. Requester-side only, until they've rated.
    let satHtml = '';
    const last = (c.messages || []).slice(-1)[0];
    const lastIsReply = last && last.sender_side === 'admin';
    if (!ST.admin && lastIsReply && !c.rating) {
      const stars = '<div class="ladmsg-stars" id="ladMsgStars">' + [1,2,3,4,5].map(n => `<button class="ladmsg-star" data-n="${n}" title="${n} star${n>1?'s':''}">★</button>`).join('') + '</div>';
      if (c.ai_handled && !c.escalated && !c.assigned_to) {
        satHtml = `<div class="ladmsg-sat" id="ladMsgSat">
          <div class="ladmsg-sat-q" id="ladMsgSatQ">Did this resolve your question?</div>
          <div class="ladmsg-sat-row" id="ladMsgSatRow"><button class="ladmsg-sat-yes" id="ladMsgSatYes">👍 Yes, thanks</button><button class="ladmsg-sat-no" id="ladMsgSatNo">I need more help</button></div>
          <div id="ladMsgRate" style="display:none"><div class="ladmsg-sat-q">How happy are you with the service?</div>${stars}</div>
        </div>`;
      } else {
        satHtml = `<div class="ladmsg-sat" id="ladMsgSat"><div class="ladmsg-sat-q">How happy are you with the service we provided?</div>${stars}</div>`;
      }
    }
    inner.innerHTML = `
      <div class="ladmsg-hd"><button class="ladmsg-back" id="ladMsgBack">‹ Back</button><h3 style="flex:1;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.subject || 'Conversation')}</h3><button class="ladmsg-x" id="ladMsgClose">×</button></div>
      ${assignBar}
      <div class="ladmsg-thread" id="ladMsgThread">${msgs || '<div class="ladmsg-empty">No messages.</div>'}</div>
      ${satHtml}
      <div class="ladmsg-compose"><textarea id="ladMsgReply" rows="2" placeholder="Write a reply…"></textarea><div class="row"><span style="flex:1"></span><button class="ladmsg-send" id="ladMsgSendBtn">Send</button></div></div>`;
    document.getElementById('ladMsgClose').onclick = closePanel;
    document.getElementById('ladMsgBack').onclick = loadList;
    const thread = document.getElementById('ladMsgThread'); thread.scrollTop = thread.scrollHeight;
    document.getElementById('ladMsgSendBtn').onclick = sendReply;
    document.getElementById('ladMsgReply').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); });
    // Satisfaction wiring
    const satNo = document.getElementById('ladMsgSatNo');
    if (satNo) satNo.onclick = async () => { satNo.disabled = true; satNo.textContent = 'Connecting you…'; try { await api('/conversations/' + id + '/escalate', { method: 'POST', body: '{}' }); } catch (_) {} await renderThread(true); };
    const satYes = document.getElementById('ladMsgSatYes');
    if (satYes) satYes.onclick = () => { const r = document.getElementById('ladMsgRate'); if (r) r.style.display = 'block'; const row = document.getElementById('ladMsgSatRow'); if (row) row.style.display = 'none'; const q = document.getElementById('ladMsgSatQ'); if (q) q.style.display = 'none'; };
    const paintStars = n => document.querySelectorAll('#ladMsgStars .ladmsg-star').forEach(s => s.classList.toggle('on', Number(s.dataset.n) <= n));
    document.querySelectorAll('#ladMsgStars .ladmsg-star').forEach(b => {
      b.onmouseenter = () => paintStars(Number(b.dataset.n));
      b.onclick = async () => { const n = Number(b.dataset.n); try { await api('/conversations/' + id + '/rate', { method: 'POST', body: JSON.stringify({ rating: n }) }); } catch (_) {} const sat = document.getElementById('ladMsgSat'); if (sat) sat.innerHTML = '<div class="ladmsg-sat-thanks">Thank you — you rated us ' + n + '/5 ★</div>'; };
    });
    if (ST.admin) {
      document.getElementById('ladMsgAssign').onchange = e => api('/conversations/' + id + '/assign', { method: 'POST', body: JSON.stringify({ assigneeId: e.target.value }) }).catch(() => {});
      document.getElementById('ladMsgStatus').onchange = e => api('/conversations/' + id + '/status', { method: 'POST', body: JSON.stringify({ status: e.target.value }) }).catch(() => {});
    }
    refreshBadge();
  }

  async function sendReply() {
    const id = ST.active; const ta = document.getElementById('ladMsgReply'); if (!ta) return;
    const body = ta.value.trim(); if (!body) return;
    const btn = document.getElementById('ladMsgSendBtn'); btn.disabled = true;
    try { await api('/conversations/' + id + '/messages', { method: 'POST', body: JSON.stringify({ body }) }); ta.value = ''; await renderThread(true); }
    catch (e) { alert(e.message); } finally { if (btn) btn.disabled = false; }
  }

  // ─── Boot ───────────────────────────────────────────────────────────
  function boot() {
    if (!token()) return;            // signed-out pages get no widget
    mount();
    refreshBadge();
    setInterval(() => { if (!ST.open) refreshBadge(); }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
