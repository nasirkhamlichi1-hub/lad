/* notifications-bell.js — in-system message bell for lawyer/firm portals.
 * Fetches GET /api/v1/notifications/mine and shows a bell with an unread count
 * and a dropdown. Include once per page:
 *   <script src="notifications-bell.js?v=1"></script>
 */
(function () {
  'use strict';
  function base(){ return ((window.LAD_API_BASE)||(window.LAD_SYNC&&window.LAD_SYNC.base)||'https://lad-clpd-backend.onrender.com').replace(/\/$/,''); }
  function tok(){ try{ return localStorage.getItem('lad_token')||''; }catch(e){ return ''; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]);}); }
  var LEVEL = { info:'#3b82f6', success:'#16a34a', warning:'#d97706', urgent:'#dc2626' };
  var items = [];

  function style(){
    if (document.getElementById('nb-style')) return;
    var s=document.createElement('style'); s.id='nb-style';
    s.textContent =
      '#nb-btn{position:fixed;top:70px;right:20px;z-index:9998;width:42px;height:42px;border-radius:50%;background:#fff;border:1px solid rgba(15,23,42,.12);box-shadow:0 6px 20px rgba(15,23,42,.12);cursor:pointer;display:grid;place-items:center;transition:transform .15s}'
      +'#nb-btn:hover{transform:translateY(-1px)}'
      +'#nb-btn svg{width:19px;height:19px;stroke:#334155;fill:none;stroke-width:1.8}'
      +'#nb-badge{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;border-radius:9px;background:#dc2626;color:#fff;font:700 10px/18px -apple-system,sans-serif;text-align:center;padding:0 4px;display:none}'
      +'#nb-panel{position:fixed;top:118px;right:20px;z-index:9999;width:360px;max-width:calc(100vw - 40px);max-height:60vh;overflow-y:auto;background:#fff;border:1px solid rgba(15,23,42,.1);border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.22);display:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
      +'#nb-panel.on{display:block}'
      +'.nb-hd{padding:13px 16px;border-bottom:1px solid #eef2f6;display:flex;align-items:center;justify-content:space-between}'
      +'.nb-hd b{font-size:14px;color:#0f172a}'
      +'.nb-read{font-size:11.5px;color:#64748b;cursor:pointer;background:none;border:0}'
      +'.nb-item{padding:12px 16px;border-bottom:1px solid #f1f5f9;display:flex;gap:11px}'
      +'.nb-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:5px}'
      +'.nb-t{font-size:13px;font-weight:600;color:#0f172a;line-height:1.3}'
      +'.nb-b{font-size:12.5px;color:#475569;line-height:1.5;margin-top:3px}'
      +'.nb-at{font-size:10.5px;color:#94a3b8;margin-top:4px;font-family:"JetBrains Mono",monospace}'
      +'.nb-empty{padding:34px 16px;text-align:center;color:#94a3b8;font-size:13px}';
    document.head.appendChild(s);
  }
  function ago(iso){ if(!iso) return ''; var d=new Date(iso); if(isNaN(d)) return ''; var s=(Date.now()-d.getTime())/1000; if(s<60)return 'just now'; if(s<3600)return Math.floor(s/60)+'m ago'; if(s<86400)return Math.floor(s/3600)+'h ago'; return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}); }

  function render(){
    var p=document.getElementById('nb-panel');
    var unread=items.filter(function(n){return !n.read_at;}).length;
    var badge=document.getElementById('nb-badge');
    if(badge){ badge.textContent=unread>99?'99+':unread; badge.style.display=unread?'block':'none'; }
    if(!p) return;
    var list = items.length ? items.map(function(n){
      var col=LEVEL[n.level]||LEVEL.info;
      return '<div class="nb-item" style="background:'+(n.read_at?'#fff':'#f8fbff')+'">'
        +'<span class="nb-dot" style="background:'+col+'"></span>'
        +'<div><div class="nb-t">'+esc(n.title||'')+'</div><div class="nb-b">'+esc(n.body||'')+'</div><div class="nb-at">'+ago(n.created_at)+'</div></div></div>';
    }).join('') : '<div class="nb-empty">No notifications yet.</div>';
    p.innerHTML='<div class="nb-hd"><b>Notifications</b>'+(unread?'<button class="nb-read" onclick="window.__nbReadAll()">Mark all read</button>':'')+'</div>'+list;
  }
  function load(){
    var t=tok(); if(!t) return;
    fetch(base()+'/api/v1/notifications/mine',{headers:{Authorization:'Bearer '+t},cache:'no-store'})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(d){ if(d&&d.notifications){ items=d.notifications; render(); } })
      .catch(function(){});
  }
  window.__nbReadAll=function(){
    var t=tok(); if(!t) return;
    fetch(base()+'/api/v1/notifications/read-all',{method:'POST',headers:{Authorization:'Bearer '+t}})
      .then(function(){ items.forEach(function(n){n.read_at=n.read_at||new Date().toISOString();}); render(); }).catch(function(){});
  };
  function toggle(){
    var p=document.getElementById('nb-panel'); var open=p.classList.toggle('on');
    if(open){ load(); }
  }
  function mount(){
    if(!tok()) return;
    style();
    var b=document.createElement('button'); b.id='nb-btn';
    b.innerHTML='<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span id="nb-badge"></span>';
    b.onclick=toggle;
    var p=document.createElement('div'); p.id='nb-panel';
    document.body.appendChild(b); document.body.appendChild(p);
    document.addEventListener('click',function(e){ var pa=document.getElementById('nb-panel'); var bt=document.getElementById('nb-btn'); if(pa&&pa.classList.contains('on')&&!pa.contains(e.target)&&!bt.contains(e.target)) pa.classList.remove('on'); });
    load(); setInterval(load, 120000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
