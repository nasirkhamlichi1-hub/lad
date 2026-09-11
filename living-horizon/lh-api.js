/**
 * Living Horizon Training — API client
 * ---------------------------------------------------------------------
 * The portal's one door to the backend. Same wire contract as the shared
 * platform client (frontend/api-client.js) — the token lives in
 * localStorage and travels as `Authorization: Bearer …` — trimmed to what
 * a staff-training portal uses: sign-in, courses, progress, materials, the
 * SCORM player, the AI trainer, and account administration. No credits, no
 * bookings, no firms.
 */
(function () {
  'use strict';

  var BASE = (typeof window !== 'undefined' && (window.LH_API_BASE || window.LAD_API_BASE)) || '';
  var TOKEN_KEY = 'lad_token';   // shared key: the backend does not care which portal set it

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  // Cold-start resilience: a container that has just been restarted can answer
  // 502/503 for a few seconds. Retry with backoff rather than show an error.
  async function fetchResilient(url, opts, attempt) {
    attempt = attempt || 1;
    try {
      var res = await fetch(url, opts);
      if (res.status >= 502 && res.status <= 504 && attempt < 4) {
        await new Promise(function (r) { setTimeout(r, attempt * 2500); });
        return fetchResilient(url, opts, attempt + 1);
      }
      return res;
    } catch (e) {
      if (attempt < 4) {
        await new Promise(function (r) { setTimeout(r, attempt * 2500); });
        return fetchResilient(url, opts, attempt + 1);
      }
      throw e;
    }
  }

  async function call(method, path, body) {
    if (!BASE) throw new Error('LH_API_BASE is not configured');
    var headers = { 'Content-Type': 'application/json' };
    var t = getToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    var res = await fetchResilient(BASE + path, {
      method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit',
    });
    if (res.status === 401) {
      setToken('');
      try { document.dispatchEvent(new CustomEvent('lad:unauthenticated')); } catch (e) {}
      var err = new Error('Unauthenticated'); err.status = 401; err.code = 'UNAUTHENTICATED'; throw err;
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var e2 = new Error(data.message || data.error || res.statusText);
      e2.status = res.status; e2.code = data.code || data.error; throw e2;
    }
    return data;
  }

  var enc = encodeURIComponent;
  var api = {
    enabled: !!BASE,
    base: BASE,

    // ─── Session ─────────────────────────────────────────────────
    isAuthenticated: function () { return !!getToken(); },
    getToken: getToken,
    setToken: setToken,
    currentUser: function () {
      if (!getToken()) return null;
      var role = '', name = '';
      try { role = localStorage.getItem('lad_role') || ''; name = localStorage.getItem('lad_name') || ''; } catch (e) {}
      return { role: role, name: name };
    },
    login: async function (username, password) {
      var res = await call('POST', '/api/v1/auth/login', { username: username, password: password });
      if (res.token) {
        setToken(res.token);
        try { localStorage.setItem('lad_role', res.role || ''); localStorage.setItem('lad_name', res.name || ''); } catch (e) {}
      }
      return res;
    },
    logout: function () {
      var t = getToken(); setToken('');
      try { localStorage.removeItem('lad_role'); localStorage.removeItem('lad_name'); } catch (e) {}
      if (BASE && t) { try { fetch(BASE + '/api/v1/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }); } catch (e) {} }
    },
    me: function () { return call('GET', '/api/v1/auth/me'); },
    brand: function () { return call('GET', '/api/v1/brand'); },
    changeMyPassword: function (oldPassword, newPassword) {
      return call('POST', '/api/v1/auth/change-password', { old_password: oldPassword, new_password: newPassword });
    },
    requestPasswordReset: function (username) { return call('POST', '/api/v1/auth/request-reset', { username: username }); },
    resetPasswordWithToken: function (token, newPassword) { return call('POST', '/api/v1/auth/reset-password', { token: token, newPassword: newPassword }); },
    myNotifications: function () { return call('GET', '/api/v1/notifications/mine'); },

    // ─── Courses, for the learner ───────────────────────────────
    catalogue:       function () { return call('GET', '/api/v1/learning/catalogue'); },
    courseOutline:   function (id) { return call('GET', '/api/v1/learning/courses/' + enc(id) + '/outline'); },
    enrolMe:         function (id) { return call('POST', '/api/v1/learning/courses/' + enc(id) + '/enrol'); },
    myEnrolments:    function () { return call('GET', '/api/v1/learning/enrolments/mine'); },
    myLearningReport: function () { return call('GET', '/api/v1/learning/report/mine'); },
    startActivity:   function (id, info) { return call('POST', '/api/v1/learning/activities/' + enc(id) + '/attempts', info || {}); },
    closeAttempt:    function (id, info) { return call('POST', '/api/v1/learning/attempts/' + enc(id) + '/close', info || {}); },
    checkpoint:      function (id, info) { return call('POST', '/api/v1/learning/attempts/' + enc(id) + '/checkpoint', info || {}); },
    activityResume:  function (id) { return call('GET', '/api/v1/learning/activities/' + enc(id) + '/resume'); },
    hubGet:          function (id) { return call('GET', '/api/v1/hubs/' + enc(id)); },
    listCourseMaterials: function (id) { return call('GET', '/api/v1/courses/' + enc(id) + '/materials'); },
    materialDownloadUrl: function (id, mid) { return call('GET', '/api/v1/courses/' + enc(id) + '/materials/' + enc(mid) + '/download-url'); },

    // ─── The AI trainer ─────────────────────────────────────────
    trainerStatus:   function () { return call('GET', '/api/v1/trainer/status'); },
    trainerLessons:  function () { return call('GET', '/api/v1/trainer/lessons'); },
    trainerAllLessons: function () { return call('GET', '/api/v1/trainer/lessons?all=1'); },
    trainerSaveLessons: function (lessons) { return call('PUT', '/api/v1/trainer/lessons', lessons); },
    trainerStartBrowserSession: function (lessonId) { return call('POST', '/api/v1/trainer/sessions', { lessonId: lessonId, engine: 'browser' }); },
    trainerPauseSession: function (id, info) { return call('POST', '/api/v1/trainer/sessions/' + enc(id) + '/pause', info || {}); },
    trainerEndSession:   function (id, info) { return call('POST', '/api/v1/trainer/sessions/' + enc(id) + '/end', info || {}); },
    trainerMyProgress:   function () { return call('GET', '/api/v1/trainer/progress/mine'); },

    // ─── Authoring (admins) ─────────────────────────────────────
    listTopics:      function () { return call('GET', '/api/v1/learning/topics'); },
    createTopic:     function (spec) { return call('POST', '/api/v1/learning/topics', spec); },
    getTopic:        function (id) { return call('GET', '/api/v1/learning/topics/' + enc(id)); },
    addTopicSteps:   function (id, spec) { return call('POST', '/api/v1/learning/topics/' + enc(id) + '/steps', spec); },
    moveTopicStep:   function (id, act, to) { return call('POST', '/api/v1/learning/topics/' + enc(id) + '/steps/' + enc(act) + '/move', { to: to }); },
    removeTopicStep: function (id, act) { return call('DELETE', '/api/v1/learning/topics/' + enc(id) + '/steps/' + enc(act)); },
    deleteTopic:     function (id) { return call('DELETE', '/api/v1/learning/topics/' + enc(id)); },
    publishTopic:    function (id, force) { return call('POST', '/api/v1/learning/topics/' + enc(id) + '/publish', { force: !!force }); },
    saveTopicModules: function (id, m) { return call('PUT', '/api/v1/learning/courses/' + enc(id) + '/modules', m); },
    saveActivities:  function (id, a) { return call('PUT', '/api/v1/learning/courses/' + enc(id) + '/activities', a); },
    draftLesson:     function (spec) { return call('POST', '/api/v1/learning/draft-lesson', spec); },
    addCourseMaterial: function (id, m) { return call('POST', '/api/v1/courses/' + enc(id) + '/materials', m); },
    updateCourseMaterial: function (id, mid, patch) { return call('PATCH', '/api/v1/courses/' + enc(id) + '/materials/' + enc(mid), patch || {}); },
    deleteCourseMaterial: function (id, mid) { return call('DELETE', '/api/v1/courses/' + enc(id) + '/materials/' + enc(mid)); },
    summariseMaterial: function (id, spec) { return call('POST', '/api/v1/courses/' + enc(id) + '/materials/summarise', spec || {}); },
    materialUploadUrl: function (id, spec) { return call('POST', '/api/v1/courses/' + enc(id) + '/materials/upload-url', spec); },
    hubSave:         function (id, hub) { return call('PUT', '/api/v1/hubs/' + enc(id), hub); },
    hubHeroUpload:   function (id, data, mime) { return call('POST', '/api/v1/hubs/' + enc(id) + '/hero', { data: data, mime: mime }); },
    hubHeroClear:    function (id) { return call('DELETE', '/api/v1/hubs/' + enc(id) + '/hero'); },

    // ─── Tracking (admins) ──────────────────────────────────────
    courseCohort:    function (id) { return call('GET', '/api/v1/learning/courses/' + enc(id) + '/cohort'); },
    learnerReport:   function (id) { return call('GET', '/api/v1/learning/learners/' + enc(id) + '/report'); },
    learningOverview: function (q) { return call('GET', '/api/v1/learning/overview' + (q ? ('?' + new URLSearchParams(q).toString()) : '')); },
    reapAttempts:    function (minutes) { return call('POST', '/api/v1/learning/maintenance/reap-attempts', minutes ? { minutes: minutes } : {}); },
    assignableTopics: function () { return call('GET', '/api/v1/learning/assignable'); },
    assignTopic:     function (id, spec) { return call('POST', '/api/v1/learning/courses/' + enc(id) + '/assign', spec || {}); },
    unassignTopic:   function (id, learnerId) { return call('DELETE', '/api/v1/learning/courses/' + enc(id) + '/assign/' + enc(learnerId)); },
    searchLearners:  function (q) { return call('GET', '/api/v1/learning/learners/search?q=' + enc(q || '')); },
    trainerLessonLearners: function (id) { return call('GET', '/api/v1/trainer/lessons/' + enc(id) + '/learners'); },

    // ─── Accounts (admins) ──────────────────────────────────────
    listUsers: function (filters) {
      var qs = filters ? '?' + Object.keys(filters).filter(function (k) { return filters[k]; })
        .map(function (k) { return enc(k) + '=' + enc(filters[k]); }).join('&') : '';
      return call('GET', '/api/v1/admin/users' + qs);
    },
    getUser:        function (id) { return call('GET', '/api/v1/admin/users/' + enc(id)); },
    createUser:     function (data) { return call('POST', '/api/v1/admin/users', data); },
    updateUser:     function (id, patch) { return call('PATCH', '/api/v1/admin/users/' + enc(id), patch); },
    resetUserPassword: function (id) { return call('POST', '/api/v1/admin/users/' + enc(id) + '/reset-password'); },
    suspendUser:    function (id) { return call('POST', '/api/v1/admin/users/' + enc(id) + '/suspend'); },
    reactivateUser: function (id) { return call('POST', '/api/v1/admin/users/' + enc(id) + '/reactivate'); },
  };

  window.LH = api;
  // The ported pages were written against window.LAD — same object.
  window.LAD = api;
  window.api = api;
})();
