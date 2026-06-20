/* ─────────────────────────────────────────────────────────────────────
 * lad-admin-guard.js — per-page role gate (defence-in-depth, front-end half).
 *
 * Include as the FIRST script in <head>, declaring who may see the page:
 *   <script src="lad-admin-guard.js" data-roles="lad_super_admin,dg"></script>
 *
 * If the signed-in user's role is NOT in data-roles, they're bounced to their
 * own home. The backend still enforces every sensitive endpoint with 403 — this
 * stops the wrong user even landing on the page (and seeing cross-firm data).
 *
 * Six user types and where each may go (set via data-roles on each page):
 *   1. lawyer                  → lawyer-portal-v2                 (own activity only)
 *   2. firm_compliance_officer → firm-compliance-portal          (own firm's lawyers)
 *   3. provider_admin          → provider-portal                 (accreditation + own-course attendance; NO profession data)
 *   4. lad_staff               → lad-staff-training              (internal training)
 *   5. lad_admin               → everyday running: lad-crm, lad-admin, trainer, users-admin (NOT accreditation/intelligence/command)
 *   6. lad_super_admin         → strategic oversight: everything incl. command-centre, lad-intelligence AND accreditation
 *
 * Admin vs super: admins run the day-to-day (courses, bookings, users,
 * customers, messaging). Super users own strategic oversight — the Command
 * Centre, Intelligence, and accreditation decisions.
 *
 * Page → roles policy:
 *   command-centre, lad-intelligence, accreditation → lad_super_admin, dg, super_admin   (SUPER ONLY)
 *   lad-crm, lad-admin                → lad_admin, lad_intelligence, +super  (LAD admins + super)
 *   users-admin                       → lad_admin, +super                    (user mgmt)
 *   lad-staff-training                → lad_staff, lad_admin, +super         (internal training)
 *   provider-portal                   → provider_admin                       (training companies only)
 *   firm-compliance-portal            → firm_compliance_officer              (firms only — not lawyers)
 *   lawyer-portal-v2                  → lawyer                               (lawyers only)
 * ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var allowed = ((script && script.getAttribute('data-roles')) || 'lad_admin,lad_intelligence,lad_super_admin,super_admin,dg')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  function tok() { try { return localStorage.getItem('lad_token') || ''; } catch (e) { return ''; } }
  // When embedded inside the CRM shell (?embed=1), the parent has already gated
  // access — never redirect the iframe (that would nest a broken page).
  try { if (/[?&]embed=1/.test(location.search)) return; } catch (e) {}
  var t = tok();
  if (!t) return; // not signed in — let the page run its own sign-in flow
  var me = {};
  try { me = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return; }
  var role = me.role || (me.user_type === 'lawyer' ? 'lawyer' : '');
  if (allowed.indexOf(role) !== -1) return; // permitted

  // Send the user to their correct home.
  var dest;
  switch (role) {
    case 'firm_compliance_officer': dest = 'firm-compliance-portal.html'; break;
    case 'provider_admin': case 'provider': dest = 'provider-portal.html'; break;
    case 'lad_staff': dest = 'lad-staff-training.html'; break;
    case 'lad_admin': case 'lad_intelligence': dest = 'lad-crm.html'; break;
    case 'lad_super_admin': case 'super_admin': case 'dg': dest = 'lad-crm.html'; break;
    case 'lawyer': dest = 'lawyer-portal-v2.html'; break;
    // Unknown role: the public landing does NOT auto-route (#public), so this
    // can never bounce into a redirect loop.
    default: dest = (me.user_type === 'lawyer') ? 'lawyer-portal-v2.html' : 'clpd-portal.html#public';
  }
  try { document.documentElement.style.display = 'none'; window.stop && window.stop(); } catch (e) {}
  location.replace(dest);
})();
