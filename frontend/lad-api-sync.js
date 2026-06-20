/* LAD CLPD — localStorage → API sync shim
   Drops in to lad-complete.html (single file with 7 portals) without changing
   the existing application code. Pattern: localStorage stays the runtime
   source of truth; this shim mirrors known keys to the real backend so other
   browsers / users see the same data.
*/
(function () {
  'use strict';

  // Resolve the API base. production host → Render API; localhost → localhost backend
  const API_BASE = (function () {
    if (typeof window === 'undefined') return '';
    if (window.LAD_API_BASE) return window.LAD_API_BASE;
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:4000';
    return 'https://lad-clpd-backend.onrender.com';
  })();

  const SYNC_KEYS = new Set([
    'lad_attendance_registry',
    'lad_admin_content',
    'lad_admin_courses',
  ]);

  const POLL_INTERVAL_MS = 12_000;

  // Save the original setItem so we can call it without recursion
  const origSet = Storage.prototype.setItem;
  const origGet = Storage.prototype.getItem;

  function actorTag() {
    try {
      const u = JSON.parse(origGet.call(localStorage, 'lad_user') || 'null');
      if (u && u.email) return u.email;
      if (u && u.id) return u.id;
    } catch { /* ignore */ }
    return 'anonymous';
  }

  function pushKey(key, value) {
    if (!SYNC_KEYS.has(key) || unsupported) return;
    let body = value;
    try { body = JSON.parse(value); } catch { /* leave as-is */ }
    fetch(`${API_BASE}/api/v1/state/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-actor': actorTag() },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => { /* offline-tolerant */ });
  }

  // Monkey-patch setItem so every write to a synced key also goes to the API
  Storage.prototype.setItem = function (key, value) {
    origSet.call(this, key, value);
    if (this === window.localStorage && SYNC_KEYS.has(key)) pushKey(key, value);
  };

  // If the backend doesn't expose /api/v1/state (the current Render backend
  // doesn't — portals read live endpoints directly), disable the shim after the
  // first 404 so it stops polling and cluttering the console.
  let unsupported = false;

  async function pullKey(key) {
    if (unsupported) return null;
    try {
      const r = await fetch(`${API_BASE}/api/v1/state/${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (r.status === 404) { unsupported = true; return null; }
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || j.data == null) return null;
      const next = typeof j.data === 'string' ? j.data : JSON.stringify(j.data);
      // Compare against existing local value; if different, write WITHOUT triggering push back
      const cur = origGet.call(localStorage, key);
      if (cur === next) return null;
      origSet.call(localStorage, key, next);
      return { key, next, prev: cur };
    } catch {
      return null;
    }
  }

  async function pullAll() {
    const changes = [];
    for (const k of SYNC_KEYS) {
      const r = await pullKey(k);
      if (r) changes.push(r);
    }
    return changes;
  }

  // On boot: fetch remote state and write to localStorage BEFORE the app reads it
  // We can't await here (script is sync), so do it ASAP and signal completion
  window.__LAD_SYNC_READY__ = false;
  pullAll().then(changes => {
    window.__LAD_SYNC_READY__ = true;
    if (changes.length) {
      window.dispatchEvent(new CustomEvent('lad:sync', { detail: changes }));
    }
  });

  // Poll for remote changes
  setInterval(async () => {
    const changes = await pullAll();
    if (changes.length) {
      window.dispatchEvent(new CustomEvent('lad:sync', { detail: changes }));
    }
  }, POLL_INTERVAL_MS);

  // Expose helpers for in-page code
  window.LAD_SYNC = {
    base: API_BASE,
    pullAll,
    push: pushKey,
    keys: Array.from(SYNC_KEYS),
  };

  // Surface a small banner the first time sync succeeds so the user knows it's live
  function showOnceBanner() {
    if (sessionStorage.getItem('lad_sync_banner_shown')) return;
    sessionStorage.setItem('lad_sync_banner_shown', '1');
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#006B3F;color:#fff;padding:10px 16px;border-radius:8px;font-family:system-ui,sans-serif;font-size:13px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.2);';
    el.textContent = '✓ Live sync active — multi-user persistence on';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  window.addEventListener('lad:sync', showOnceBanner, { once: true });

  console.log('[lad-api-sync] active, base=', API_BASE);
})();
