/* ai-assistant.js — role-aware AI assistant (⌘K) for every portal.
 * LAD roles → /admin/command (answers + session/notify actions).
 * Firm officers → /assistant/command (answers + "notify my firm").
 * Lawyers / providers → /assistant/command (answers grounded in their data).
 * Include once: <script src="ai-assistant.js?v=1"></script>
 */
(function () {
  'use strict';
  function base(){ return ((window.LAD_API_BASE)||(window.LAD_SYNC&&window.LAD_SYNC.base)||'https://lad-clpd-backend.onrender.com').replace(/\/$/,''); }
  function tok(){ try{ return localStorage.getItem('lad_token')||''; }catch(e){ return ''; } }
  function role(){ try{ return (localStorage.getItem('lad_role')||'').toLowerCase(); }catch(e){ return ''; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]);}); }
  var LAD_ROLES = ['lad_admin','lad_intelligence','lad_super_admin','super_admin','dg'];
  function isLAD(){ return LAD_ROLES.indexOf(role())!==-1; }
  function endpoint(){ return base() + (isLAD() ? '/api/v1/admin/command' : '/api/v1/assistant/command'); }
  var plan = null;

  function style(){
    if (document.getElementById('aia-style')) return;
    var s=document.createElement('style'); s.id='aia-style';
    s.textContent =
      '#aia-fab{position:fixed;left:20px;bottom:20px;z-index:9997;background:linear-gradient(135deg,#0a3a28,#0d5a4a);color:#fff;border:0;border-radius:26px;padding:11px 17px;font:700 13px/1 -apple-system,sans-serif;cursor:pointer;box-shadow:0 8px 26px rgba(10,58,40,.38);display:flex;align-items:center;gap:8px}'
      +'#aia-fab .k{font-family:"JetBrains Mono",monospace;font-size:10px;background:rgba(255,255,255,.18);padding:2px 6px;border-radius:5px}'
      +'#aia-ov{position:fixed;inset:0;background:rgba(8,18,12,.55);backdrop-filter:blur(8px);z-index:9999;display:none;align-items:flex-start;justify-content:center;padding:78px 20px}'
      +'#aia-ov.on{display:flex}'
      +'.aia-p{background:#fff;border-radius:18px;max-width:640px;width:100%;box-shadow:0 40px 100px rgba(0,0,0,.4);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-height:80vh;display:flex;flex-direction:column}'
      +'.aia-h{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid #eef2ee}'
      +'.aia-in{flex:1;border:0;outline:0;font-size:16px;color:#0d1b14;font-family:inherit;background:none}'
      +'.aia-esc{font-family:"JetBrains Mono",monospace;font-size:10px;color:#8a9a90;background:#f1f4f1;border:1px solid #e3e9e4;border-radius:6px;padding:3px 7px;cursor:pointer}'
      +'.aia-b{padding:16px 18px;overflow-y:auto}'
      +'.aia-chip{display:inline-block;background:#f1f4f1;border:1px solid #e3e9e4;border-radius:18px;padding:7px 13px;font-size:12.5px;color:#3a4a40;margin:0 6px 8px 0;cursor:pointer}'
      +'.aia-chip:hover{border-color:#006B3F;color:#006B3F}'
      +'.aia-ans{font-size:14px;line-height:1.65;color:#1a2a20;white-space:pre-wrap;background:#f6f8f6;border:1px solid #e3e9e4;border-left:3px solid #0d7377;border-radius:10px;padding:15px 17px}'
      +'.aia-eng{font-family:"JetBrains Mono",monospace;font-size:9px;color:#aab8af;letter-spacing:.5px;margin-top:8px;text-transform:uppercase}'
      +'.aia-btn{background:#006B3F;color:#fff;border:0;border-radius:9px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}'
      +'.aia-btn.alt{background:#fff;color:#006B3F;border:1px solid #006B3F}';
    document.head.appendChild(s);
  }
  function chips(){
    if (isLAD()) return ['Which firms are below 50% compliant?','Which sessions have fewer than 5 seats?','Notify all critical lawyers to book before 31 December'];
    if (role()==='firm_compliance_officer') return ['How is my firm tracking for 31 December?','Who in my firm is critical?','Remind my firm to book their remaining courses'];
    if (role()==='provider_admin') return ['How many of my accreditations are approved?','What\'s pending review?'];
    return ['How many points do I still need?','What should I book next?','How many days until the deadline?'];
  }
  function open(){ document.getElementById('aia-ov').classList.add('on'); setTimeout(function(){var i=document.getElementById('aia-in');if(i)i.focus();},50); }
  function close(){ document.getElementById('aia-ov').classList.remove('on'); }
  function setBody(html){ document.getElementById('aia-body').innerHTML=html; }
  function home(){ setBody('<div id="aia-chips">'+chips().map(function(c){return '<span class="aia-chip">'+esc(c)+'</span>';}).join('')+'</div><div id="aia-ans"></div>');
    document.querySelectorAll('#aia-chips .aia-chip').forEach(function(el){ el.onclick=function(){ document.getElementById('aia-in').value=el.textContent; ask(); }; }); }

  function ask(){
    var q=(document.getElementById('aia-in').value||'').trim(); if(!q) return;
    var a=document.getElementById('aia-ans'); if(a)a.innerHTML='<div class="aia-ans">Thinking…</div>';
    var chipsEl=document.getElementById('aia-chips'); if(chipsEl)chipsEl.style.display='none';
    fetch(endpoint(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok()},body:JSON.stringify({prompt:q})})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(x){
        if(!x.ok){ if(a)a.innerHTML='<div class="aia-ans">'+esc(x.d.error||'Could not answer.')+'</div>'; return; }
        if(x.d.intent && x.d.intent!=='answer'){ renderPlan(x.d); return; }
        if(a)a.innerHTML='<div class="aia-ans">'+esc(x.d.answer||'')+'</div><div class="aia-eng">'+(x.d.engine==='aimodel'?'Powered by AiModel · live data':'Live data')+'</div>';
      }).catch(function(){ if(a)a.innerHTML='<div class="aia-ans">Network error.</div>'; });
  }
  function renderPlan(d){
    plan=d; var a=document.getElementById('aia-ans');
    var color = d.intent==='cancel_session' ? '#c0392b' : '#0d7377';
    var label = ({cancel_session:'Cancel session',reschedule_session:'Reschedule session',notify:'Send notification',notify_firm:'Message your firm'})[d.intent]||'Action';
    var detail='';
    if(d.intent==='cancel_session'||d.intent==='reschedule_session'){ var s=(d.params&&d.params.session)||{}; detail='<div style="margin-top:8px;font-size:12.5px;color:#475569"><strong>'+esc(s.title||'')+'</strong> · '+(s.booked||0)+' booked'+(d.params.scheduled_at?(' → '+esc(new Date(d.params.scheduled_at).toUTCString())):'')+'</div>'; }
    else if(d.intent==='notify'||d.intent==='notify_firm'){ var aud=d.intent==='notify_firm'?'your firm':((d.params.audience==='segment')?('segment '+esc(JSON.stringify(d.params.segment||{}))):'everyone'); detail='<div style="margin-top:8px;font-size:12.5px;color:#475569">To: '+aud+'<br><strong>'+esc(d.params.title||'')+'</strong><br>'+esc(d.params.body||'')+'</div>'; }
    if(a)a.innerHTML='<div class="aia-ans" style="border-left-color:'+color+'"><div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:'+color+';font-weight:700;margin-bottom:6px">Proposed · '+esc(label)+'</div><div style="font-size:14px;color:#0f172a">'+esc(d.summary||'')+'</div>'+detail+'<div style="display:flex;gap:8px;margin-top:14px"><button class="aia-btn" style="background:'+color+'" id="aia-go">Confirm &amp; run</button><button class="aia-btn alt" id="aia-no">Cancel</button></div><div id="aia-res" style="margin-top:10px;font-size:12.5px"></div></div>';
    document.getElementById('aia-go').onclick=execute;
    document.getElementById('aia-no').onclick=function(){ plan=null; home(); };
  }
  function execute(){
    var d=plan; if(!d) return; var rEl=document.getElementById('aia-res'); if(rEl)rEl.textContent='Running…';
    var url, opts={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok()}};
    if(d.intent==='cancel_session'){ url=base()+'/api/v1/courses/sessions/'+encodeURIComponent(d.params.sessionId)+'/cancel'; }
    else if(d.intent==='reschedule_session'){ url=base()+'/api/v1/courses/sessions/'+encodeURIComponent(d.params.sessionId)+'/reschedule'; opts.body=JSON.stringify({scheduled_at:d.params.scheduled_at,venue:d.params.venue}); }
    else if(d.intent==='notify'){ url=base()+'/api/v1/notifications/send'; opts.body=JSON.stringify(d.params); }
    else if(d.intent==='notify_firm'){ url=base()+'/api/v1/notifications/send'; opts.body=JSON.stringify({audience:'firm',title:d.params.title,body:d.params.body}); }
    else { if(rEl)rEl.textContent='Unknown action.'; return; }
    fetch(url,opts).then(function(r){return r.json().then(function(jd){return {ok:r.ok,jd:jd};});}).then(function(x){
      if(x.ok){ var m=(d.intent==='notify'||d.intent==='notify_firm')?('✓ '+(x.jd.message||'Sent.')):('✓ Done'+(x.jd.refunded!=null?(' · '+x.jd.refunded+' refunded'):'')+(x.jd.notified!=null?(' · '+x.jd.notified+' notified'):'')); if(rEl)rEl.innerHTML='<span style="color:#16a34a;font-weight:600">'+esc(m)+'</span>'; plan=null; }
      else if(rEl){ rEl.innerHTML='<span style="color:#c0392b">'+esc(x.jd.error||x.jd.message||'Failed.')+'</span>'; }
    }).catch(function(){ if(rEl)rEl.innerHTML='<span style="color:#c0392b">Network error.</span>'; });
  }
  function mount(){
    if(!tok()) return;
    style();
    var b=document.createElement('button'); b.id='aia-fab'; b.innerHTML='✦ Ask Maryam <span class="k">⌘K</span>'; b.onclick=open;
    var ov=document.createElement('div'); ov.id='aia-ov';
    ov.innerHTML='<div class="aia-p"><div class="aia-h"><span style="font-size:18px">✦</span><input id="aia-in" class="aia-in" placeholder="Ask anything…"/><span class="aia-esc" id="aia-x">ESC</span></div><div class="aia-b" id="aia-body"></div></div>';
    document.body.appendChild(b); document.body.appendChild(ov);
    ov.onclick=function(e){ if(e.target===ov) close(); };
    document.getElementById('aia-x').onclick=close;
    document.getElementById('aia-in').addEventListener('keydown',function(e){ if(e.key==='Enter')ask(); });
    home();
    document.addEventListener('keydown',function(e){ if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){ e.preventDefault(); var o=document.getElementById('aia-ov'); o.classList.contains('on')?close():open(); } else if(e.key==='Escape'){ var o2=document.getElementById('aia-ov'); if(o2&&o2.classList.contains('on'))close(); } });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
