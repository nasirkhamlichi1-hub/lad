/* ai-assistant.js — role-aware conversational AI assistant (⌘K) for every portal.
 * LAD roles → /admin/command (answers + session/notify actions).
 * Firm officers → /assistant/command (answers + "notify my firm").
 * Lawyers / providers → /assistant/command (answers grounded in their data).
 * Multi-turn: the whole thread is kept and sent as `history` so you can drill down.
 * Include once: <script src="ai-assistant.js?v=3"></script>
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

  // Conversation state: [{role:'user'|'assistant', content, plan?, result?}]
  var convo = [];
  var busy = false;

  function style(){
    if (document.getElementById('aia-style')) return;
    var s=document.createElement('style'); s.id='aia-style';
    s.textContent =
      '#aia-fab{position:fixed;left:20px;bottom:20px;z-index:9997;background:linear-gradient(135deg,#0a3a28,#0d5a4a);color:#fff;border:0;border-radius:26px;padding:11px 17px;font:700 13px/1 -apple-system,sans-serif;cursor:pointer;box-shadow:0 8px 26px rgba(10,58,40,.38);display:flex;align-items:center;gap:8px}'
      +'#aia-fab .k{font-family:"JetBrains Mono",monospace;font-size:10px;background:rgba(255,255,255,.18);padding:2px 6px;border-radius:5px}'
      +'#aia-ov{position:fixed;inset:0;background:rgba(8,18,12,.55);backdrop-filter:blur(8px);z-index:9999;display:none;align-items:flex-start;justify-content:center;padding:64px 20px}'
      +'#aia-ov.on{display:flex}'
      +'.aia-p{background:#fff;border-radius:18px;max-width:640px;width:100%;box-shadow:0 40px 100px rgba(0,0,0,.4);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-height:82vh;display:flex;flex-direction:column}'
      +'.aia-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #eef2ee;flex:0 0 auto}'
      +'.aia-title{font-weight:700;font-size:13px;color:#0d1b14;display:flex;align-items:center;gap:7px}'
      +'.aia-new{margin-left:auto;font-size:11px;color:#8a9a90;background:#f1f4f1;border:1px solid #e3e9e4;border-radius:6px;padding:4px 9px;cursor:pointer}'
      +'.aia-new:hover{color:#006B3F;border-color:#006B3F}'
      +'.aia-esc{font-family:"JetBrains Mono",monospace;font-size:10px;color:#8a9a90;background:#f1f4f1;border:1px solid #e3e9e4;border-radius:6px;padding:4px 7px;cursor:pointer}'
      +'.aia-thread{flex:1 1 auto;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}'
      +'.aia-chip{display:inline-block;background:#f1f4f1;border:1px solid #e3e9e4;border-radius:18px;padding:7px 13px;font-size:12.5px;color:#3a4a40;margin:0 6px 8px 0;cursor:pointer}'
      +'.aia-chip:hover{border-color:#006B3F;color:#006B3F}'
      +'.aia-intro{font-size:13px;color:#5a6a60;line-height:1.6;margin-bottom:4px}'
      +'.aia-row{display:flex;flex-direction:column;max-width:90%}'
      +'.aia-row.u{align-self:flex-end;align-items:flex-end}'
      +'.aia-row.a{align-self:flex-start;align-items:flex-start}'
      +'.aia-msg-u{background:#006B3F;color:#fff;border-radius:14px 14px 4px 14px;padding:10px 14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap}'
      +'.aia-msg-a{background:#f6f8f6;border:1px solid #e3e9e4;border-left:3px solid #0d7377;color:#1a2a20;border-radius:4px 14px 14px 14px;padding:12px 15px;font-size:14px;line-height:1.65;white-space:pre-wrap}'
      +'.aia-eng{font-family:"JetBrains Mono",monospace;font-size:9px;color:#aab8af;letter-spacing:.5px;margin-top:6px;text-transform:uppercase}'
      +'.aia-foot{flex:0 0 auto;border-top:1px solid #eef2ee;padding:12px 16px;display:flex;align-items:center;gap:9px}'
      +'.aia-in{flex:1;border:1px solid #e3e9e4;outline:0;font-size:14px;color:#0d1b14;font-family:inherit;background:#fafbfa;border-radius:11px;padding:11px 13px}'
      +'.aia-in:focus{border-color:#006B3F;background:#fff}'
      +'.aia-send{background:#006B3F;color:#fff;border:0;border-radius:11px;width:42px;height:42px;font-size:16px;cursor:pointer;flex:0 0 auto}'
      +'.aia-send:disabled{opacity:.5;cursor:default}'
      +'.aia-btn{background:#006B3F;color:#fff;border:0;border-radius:9px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}'
      +'.aia-btn.alt{background:#fff;color:#006B3F;border:1px solid #006B3F}'
      +'.aia-typing{display:inline-flex;gap:4px;align-items:center}'
      +'.aia-typing i{width:6px;height:6px;border-radius:50%;background:#9bb0a4;display:inline-block;animation:aiablink 1.2s infinite}'
      +'.aia-typing i:nth-child(2){animation-delay:.2s}.aia-typing i:nth-child(3){animation-delay:.4s}'
      +'@keyframes aiablink{0%,60%,100%{opacity:.25}30%{opacity:1}}';
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
  function reset(){ convo=[]; render(); var i=document.getElementById('aia-in'); if(i){ i.value=''; i.focus(); } }

  function planLabel(intent){ return ({cancel_session:'Cancel session',reschedule_session:'Reschedule session',notify:'Send notification',notify_firm:'Message your firm',book_course:'Book a course'})[intent]||'Action'; }
  function planColor(intent){ return intent==='cancel_session' ? '#c0392b' : '#0d7377'; }
  function planDetail(d){
    if(d.intent==='cancel_session'||d.intent==='reschedule_session'){ var s=(d.params&&d.params.session)||{}; return '<div style="margin-top:8px;font-size:12.5px;color:#475569"><strong>'+esc(s.title||'')+'</strong> · '+(s.booked||0)+' booked'+(d.params.scheduled_at?(' → '+esc(new Date(d.params.scheduled_at).toUTCString())):'')+'</div>'; }
    if(d.intent==='book_course'){ var bs=(d.params&&d.params.session)||{}; return '<div style="margin-top:8px;font-size:12.5px;color:#475569"><strong>'+esc(bs.title||'')+'</strong>'+(bs.scheduled_at?(' · '+esc(new Date(bs.scheduled_at).toUTCString())):'')+' · '+(bs.credits||5)+' credits</div>'; }
    if(d.intent==='notify'||d.intent==='notify_firm'){ var aud=d.intent==='notify_firm'?'your firm':((d.params.audience==='segment')?('segment '+esc(JSON.stringify(d.params.segment||{}))):'everyone'); return '<div style="margin-top:8px;font-size:12.5px;color:#475569">To: '+aud+'<br><strong>'+esc(d.params.title||'')+'</strong><br>'+esc(d.params.body||'')+'</div>'; }
    return '';
  }

  function render(){
    var t=document.getElementById('aia-thread'); if(!t) return;
    if(!convo.length){
      t.innerHTML='<div class="aia-intro">Ask me anything about your live data — then keep going to drill deeper.</div>'
        +'<div>'+chips().map(function(c){return '<span class="aia-chip">'+esc(c)+'</span>';}).join('')+'</div>';
      t.querySelectorAll('.aia-chip').forEach(function(el){ el.onclick=function(){ submit(el.textContent); }; });
      return;
    }
    var html='';
    convo.forEach(function(m,idx){
      if(m.role==='user'){ html+='<div class="aia-row u"><div class="aia-msg-u">'+esc(m.content)+'</div></div>'; return; }
      // assistant
      if(m.pending){ html+='<div class="aia-row a"><div class="aia-msg-a"><span class="aia-typing"><i></i><i></i><i></i></span></div></div>'; return; }
      if(m.plan){
        var d=m.plan, color=planColor(d.intent);
        html+='<div class="aia-row a" style="max-width:96%"><div class="aia-msg-a" style="border-left-color:'+color+'">'
          +'<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:'+color+';font-weight:700;margin-bottom:6px">Proposed · '+esc(planLabel(d.intent))+'</div>'
          +'<div style="font-size:14px;color:#0f172a">'+esc(d.summary||'')+'</div>'+planDetail(d);
        if(m.result){ html+='<div style="margin-top:10px;font-size:12.5px">'+m.result+'</div>'; }
        else { html+='<div style="display:flex;gap:8px;margin-top:14px"><button class="aia-btn" style="background:'+color+'" data-go="'+idx+'">Confirm &amp; run</button><button class="aia-btn alt" data-no="'+idx+'">Dismiss</button></div>'; }
        html+='</div></div>';
        return;
      }
      html+='<div class="aia-row a"><div class="aia-msg-a">'+esc(m.content||'')+(m.engine?('<div class="aia-eng">'+(m.engine==='aimodel'?'Powered by AiModel · live data':'Live data')+'</div>'):'')+'</div></div>';
    });
    t.innerHTML=html;
    t.querySelectorAll('[data-go]').forEach(function(b){ b.onclick=function(){ execute(parseInt(b.getAttribute('data-go'),10)); }; });
    t.querySelectorAll('[data-no]').forEach(function(b){ b.onclick=function(){ var i=parseInt(b.getAttribute('data-no'),10); convo[i].result='<span style="color:#8a9a90">Dismissed.</span>'; render(); }; });
    t.scrollTop=t.scrollHeight;
  }

  // Build the history payload the backend expects: prior turns, text only.
  function historyPayload(){
    return convo.filter(function(m){ return !m.pending && typeof m.content==='string' && m.content; })
      .map(function(m){ return {role:m.role, content:m.content}; }).slice(-8);
  }

  function submit(text){
    var q=(text||'').trim(); if(!q||busy) return;
    convo.push({role:'user', content:q});
    var hist=historyPayload();              // history = prior turns (excludes the new question)
    var aMsg={role:'assistant', pending:true, content:''}; convo.push(aMsg);
    busy=true; setSend(); render();
    fetch(endpoint(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok()},
      body:JSON.stringify({prompt:q, history:hist.slice(0,-1)})})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(x){
        aMsg.pending=false;
        if(!x.ok){ aMsg.content=x.d.error||'Could not answer.'; }
        else if(x.d.intent && x.d.intent!=='answer'){ aMsg.plan=x.d; aMsg.content=x.d.summary||planLabel(x.d.intent); }
        else { aMsg.content=x.d.answer||''; aMsg.engine=x.d.engine; }
      })
      .catch(function(){ aMsg.pending=false; aMsg.content='Network error — please try again.'; })
      .then(function(){ busy=false; setSend(); render(); });
  }
  function setSend(){ var b=document.getElementById('aia-send'); if(b) b.disabled=busy; }

  function execute(idx){
    var m=convo[idx]; if(!m||!m.plan) return; var d=m.plan;
    m.result='Running…'; render();
    var url, opts={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok()}};
    if(d.intent==='cancel_session'){ url=base()+'/api/v1/courses/sessions/'+encodeURIComponent(d.params.sessionId)+'/cancel'; }
    else if(d.intent==='reschedule_session'){ url=base()+'/api/v1/courses/sessions/'+encodeURIComponent(d.params.sessionId)+'/reschedule'; opts.body=JSON.stringify({scheduled_at:d.params.scheduled_at,venue:d.params.venue}); }
    else if(d.intent==='notify'){ url=base()+'/api/v1/notifications/send'; opts.body=JSON.stringify(d.params); }
    else if(d.intent==='notify_firm'){ url=base()+'/api/v1/notifications/send'; opts.body=JSON.stringify({audience:'firm',title:d.params.title,body:d.params.body}); }
    else if(d.intent==='book_course'){ var bs=(d.params&&d.params.session)||{}; url=base()+'/api/v1/bookings'; opts.body=JSON.stringify({course_id:bs.course_id,session_id:bs.id,course_title:bs.title,scheduled_at:bs.scheduled_at,credits_used:bs.credits||5}); }
    else { m.result='<span style="color:#c0392b">Unknown action.</span>'; render(); return; }
    fetch(url,opts).then(function(r){return r.json().then(function(jd){return {ok:r.ok,status:r.status,jd:jd};});}).then(function(x){
      if(x.ok){
        var msg;
        if(d.intent==='notify'||d.intent==='notify_firm') msg='✓ '+(x.jd.message||'Sent.');
        else if(d.intent==='book_course') msg='✓ Booked'+(x.jd.balance!=null?(' · '+x.jd.balance+' credits left'):'');
        else msg='✓ Done'+(x.jd.refunded!=null?(' · '+x.jd.refunded+' refunded'):'')+(x.jd.notified!=null?(' · '+x.jd.notified+' notified'):'');
        m.result='<span style="color:#16a34a;font-weight:600">'+esc(msg)+'</span>';
        if(d.intent==='book_course') setTimeout(function(){ try{ location.reload(); }catch(_){} }, 1400);
      }
      else if(x.status===402){ m.result='<span style="color:#c2703d">'+esc(x.jd.message||'Not enough credits — top up to book.')+'</span>'; }
      else { m.result='<span style="color:#c0392b">'+esc(x.jd.error||x.jd.message||'Failed.')+'</span>'; }
      render();
    }).catch(function(){ m.result='<span style="color:#c0392b">Network error.</span>'; render(); });
  }

  function mount(){
    if(!tok()) return;
    style();
    var b=document.createElement('button'); b.id='aia-fab'; b.innerHTML='✦ Ask Maryam <span class="k">⌘K</span>'; b.onclick=open;
    var ov=document.createElement('div'); ov.id='aia-ov';
    ov.innerHTML='<div class="aia-p">'
      +'<div class="aia-h"><span class="aia-title"><span style="font-size:16px">✦</span> Maryam · AI assistant</span>'
        +'<span class="aia-new" id="aia-new">＋ New chat</span><span class="aia-esc" id="aia-x">ESC</span></div>'
      +'<div class="aia-thread" id="aia-thread"></div>'
      +'<div class="aia-foot"><input id="aia-in" class="aia-in" placeholder="Ask a follow-up…" autocomplete="off"/>'
        +'<button class="aia-send" id="aia-send" title="Send">↑</button></div>'
      +'</div>';
    document.body.appendChild(b); document.body.appendChild(ov);
    ov.onclick=function(e){ if(e.target===ov) close(); };
    document.getElementById('aia-x').onclick=close;
    document.getElementById('aia-new').onclick=reset;
    document.getElementById('aia-send').onclick=function(){ var i=document.getElementById('aia-in'); var v=i.value; i.value=''; submit(v); };
    document.getElementById('aia-in').addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); var v=this.value; this.value=''; submit(v); } });
    render();
    document.addEventListener('keydown',function(e){ if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){ e.preventDefault(); var o=document.getElementById('aia-ov'); o.classList.contains('on')?close():open(); } else if(e.key==='Escape'){ var o2=document.getElementById('aia-ov'); if(o2&&o2.classList.contains('on'))close(); } });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
