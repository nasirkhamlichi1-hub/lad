/**
 * LAD CLPD — Frontend API client
 * ---------------------------------------------------------------------
 * Talks to the backend REST API. If `window.LAD_API_BASE` is unset (no backend
 * configured) all methods fall back to localStorage, so the static frontend
 * keeps working as a demo.
 *
 * In every HTML portal, before any other inline script, include:
 *
 *   <script>window.LAD_API_BASE = 'https://api.your-domain.ae';</script>
 *   <script src="api-client.js"></script>
 *
 * The JWT issued by the backend after UAE Pass auth lives in
 * localStorage.lad_token and is added as `Authorization: Bearer ...` to
 * every request automatically.
 */
(function () {
  'use strict';

  const BASE = (typeof window !== 'undefined' && window.LAD_API_BASE) || '';
  const ENABLED = !!BASE;
  const TOKEN_KEY = 'lad_token';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
  }

  async function call(method, path, body) {
    if (!ENABLED) throw new Error('LAD_API_BASE not configured');
    const headers = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) headers.Authorization = 'Bearer ' + t;

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
    });

    if (res.status === 401) {
      setToken('');
      // Let the caller decide what to do on auth failure. The portal pages
      // already have a sign-in modal; bouncing to UAE Pass directly is wrong
      // when UAE Pass isn't configured or when the user came in via password.
      const err = new Error('Unauthenticated');
      err.status = 401;
      err.code = 'UNAUTHENTICATED';
      throw err;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  // ─── localStorage fallback ────────────────────────────────────────
  const STORE = { COURSES: 'lad_courses', CONTENT: 'lad_content', FAQ: 'lad_faq' };

  function lsGet(key, dflt) {
    try { return JSON.parse(localStorage.getItem(key)) || dflt; }
    catch { return dflt; }
  }

  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
    return val;
  }

  // ─── Public API ───────────────────────────────────────────────────
  const api = {
    enabled: ENABLED,
    base: BASE,

    // Auth
    isAuthenticated: () => !!getToken(),
    getToken,
    setToken,
    logout: () => {
      const t = getToken();
      setToken('');
      if (ENABLED && t) {
        fetch(BASE + '/api/v1/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
      }
    },
    loginWithUaePass: () => {
      if (ENABLED) window.location.href = BASE + '/api/v1/auth/uaepass/login';
      else alert('Backend not configured — UAE Pass requires a running backend');
    },
    // Unified password sign-in for EVERY role (lawyer, firm CO, LAD admin,
    // super_admin, reviewer, provider). The username field accepts:
    //   - any registered email address, OR
    //   - a lawyer number (e.g. L-01494), OR
    //   - a bar number (e.g. BAR-1496)
    // The backend tries `staff.email` first, then `lawyers.email / id / bar_no`,
    // and bcrypt-verifies the password against the matching row. Caller does
    // not need to know the role in advance — the response includes role + name
    // so the frontend can redirect.
    login: async function(username, password) {
      if (!ENABLED) throw new Error('Backend not configured');
      const res = await call('POST', '/api/v1/auth/login', { username, password });
      if (res.token) {
        setToken(res.token);
        try {
          localStorage.setItem('lad_role', res.role || '');
          localStorage.setItem('lad_name', res.name || '');
        } catch (_) {}
      }
      return res;
    },
    // Deprecated wrapper kept so existing call sites continue to work while
    // the frontend is migrated. New code should call `login()` above.
    loginWithPassword: async function(usernameOrEmail, password /*, role (ignored) */) {
      return this.login(usernameOrEmail, password);
    },
    me: () => ENABLED ? call('GET', '/api/v1/auth/me') : Promise.reject(new Error('offline')),

    // Catalog
    getCourses: () => ENABLED ? call('GET', '/api/v1/courses') : Promise.resolve(lsGet(STORE.COURSES, [])),
    getCourse: (id) => ENABLED ? call('GET', '/api/v1/courses/' + encodeURIComponent(id)) : Promise.resolve((lsGet(STORE.COURSES, []).find(c => c.id === id))),
    saveCourse: (c) => ENABLED ? call('PUT', '/api/v1/courses/' + encodeURIComponent(c.id), c)
                              : Promise.resolve(lsSet(STORE.COURSES, [...(lsGet(STORE.COURSES, []).filter(x => x.id !== c.id)), c])),
    deleteCourse: (id) => ENABLED ? call('DELETE', '/api/v1/courses/' + encodeURIComponent(id))
                                   : Promise.resolve(lsSet(STORE.COURSES, lsGet(STORE.COURSES, []).filter(c => c.id !== id))),
    getSchedules: () => ENABLED ? call('GET', '/api/v1/courses/sessions/all') : Promise.resolve([]),
    bulkUpsertSchedule: (rows) => ENABLED ? call('POST', '/api/v1/courses/sessions/bulk', rows) : Promise.resolve(rows),

    // CMS
    getContent: () => ENABLED ? call('GET', '/api/v1/content') : Promise.resolve(lsGet(STORE.CONTENT, {})),
    saveContent: (c) => ENABLED ? call('PUT', '/api/v1/content', c) : Promise.resolve(lsSet(STORE.CONTENT, c)),
    getFAQ: () => ENABLED ? call('GET', '/api/v1/faq') : Promise.resolve(lsGet(STORE.FAQ, [])),
    saveFAQ: (items) => ENABLED ? call('PUT', '/api/v1/faq', items) : Promise.resolve(lsSet(STORE.FAQ, items)),

    // Composite (used by portal boot)
    getFullConfig: async function() {
      if (ENABLED) return call('GET', '/api/v1/config');
      const [courses, content, faq] = await Promise.all([this.getCourses(), this.getContent(), this.getFAQ()]);
      return { version: '1.0', generated: new Date().toISOString(), courses, content, faq };
    },

    // Lawyers / firms
    myProfile: () => ENABLED ? call('GET', '/api/v1/lawyers/me') : Promise.reject(new Error('offline')),
    getFirms: () => ENABLED ? call('GET', '/api/v1/firms') : Promise.resolve([]),
    getFirm: (id) => ENABLED ? call('GET', '/api/v1/firms/' + encodeURIComponent(id)) : Promise.resolve({}),
    getFirmLawyers: (id) => ENABLED ? call('GET', '/api/v1/firms/' + encodeURIComponent(id) + '/lawyers') : Promise.resolve([]),
    getFirmBookings: (id) => ENABLED ? call('GET', '/api/v1/firms/' + encodeURIComponent(id) + '/bookings') : Promise.resolve([]),

    // Bookings
    createBooking: (b) => ENABLED ? call('POST', '/api/v1/bookings', b) : Promise.reject(new Error('offline')),
    updateBooking: (id, patch) => ENABLED ? call('PATCH', '/api/v1/bookings/' + encodeURIComponent(id), patch) : Promise.reject(new Error('offline')),

    // Stats
    getAggregateStats: () => ENABLED ? call('GET', '/api/v1/stats/aggregate') : Promise.resolve({}),
    getFirmStats: (id) => ENABLED ? call('GET', '/api/v1/stats/firm/' + encodeURIComponent(id)) : Promise.resolve({}),

    // Lex chat (server-side Anthropic proxy)
    lexChat: (messages, system) => ENABLED ? call('POST', '/api/v1/lex/chat', { messages, system })
                                            : Promise.reject(new Error('offline')),

    // ─── Admin: user management ──────────────────────────────────────
    listUsers: (filters) => {
      if (!ENABLED) return Promise.resolve({ users: [], count: 0 });
      const qs = filters ? '?' + Object.entries(filters).filter(([_,v]) => v).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
      return call('GET', '/api/v1/admin/users' + qs);
    },
    createUser:    (data)         => call('POST',  '/api/v1/admin/users', data),
    updateUser:    (id, patch)    => call('PATCH', '/api/v1/admin/users/' + encodeURIComponent(id), patch),
    resetUserPassword: (id)       => call('POST',  '/api/v1/admin/users/' + encodeURIComponent(id) + '/reset-password'),
    suspendUser:   (id)           => call('POST',  '/api/v1/admin/users/' + encodeURIComponent(id) + '/suspend'),
    reactivateUser: (id)          => call('POST',  '/api/v1/admin/users/' + encodeURIComponent(id) + '/reactivate'),
    listFirmsForAdmin: ()         => call('GET',   '/api/v1/admin/users/firms/list'),

    // Self-service password change (used by the first-login flow)
    changeMyPassword: (oldPassword, newPassword) =>
      call('POST', '/api/v1/auth/change-password', { currentPassword: oldPassword, newPassword }),
    requestPasswordReset: (username) =>
      call('POST', '/api/v1/auth/request-reset', { username }),
    resetPasswordWithToken: (token, newPassword) =>
      call('POST', '/api/v1/auth/reset-password', { token, newPassword }),
  };

  window.LAD = api;
  // Backwards compat alias used by existing code
  window.api = api;
})();
