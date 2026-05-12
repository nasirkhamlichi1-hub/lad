# v8 — User Management Release

## What's in this release

Two-tier admin user management, end-to-end:

- **New role:** `lad_super_admin` (full powers, including managing other admins)
- **Existing role enhanced:** `lad_admin` can now manage non-admin accounts via the UI
- **Existing role enhanced:** `firm_compliance_officer` can now manage lawyers in their own firm via the UI
- **New page:** `/users-admin.html` — the user management UI, role-aware (each admin sees the right subset)
- **New page:** `/change-password.html` — first-login forced password change
- **New backend routes:** `/api/v1/admin/users` (list/create/update/suspend/reactivate/reset-password)
- **New backend route:** `/api/v1/auth/change-password` (self-service)
- **Migration 003** — adds `must_change_password`, `password_changed_at`, `created_by_*` columns
- **Updated `create-account.js`** — supports `lad_super_admin` role + `--must-change-password` flag
- **Login flow updated** — if backend returns `must_change_password: true`, user is redirected to `/change-password.html` before reaching the portal

## Deploy steps

### 1. Push the code

Two options. Pick one.

**Option A — local git (recommended):**

```powershell
cd C:\dev\lad
# Extract the v8 zip over the existing folder (overwrites, doesn't delete)
# Then:
git add .
git commit -m "v8: two-tier admin user management"
git push
```

GitHub Actions builds the new backend image (~3 min) and pushes to GHCR. Render auto-pulls. Netlify auto-deploys the frontend (~30 sec).

**Option B — GitHub web UI:** edit each changed file in the browser and commit. Slower but works if PowerShell is misbehaving.

Changed/new files (relative to `C:\dev\lad`):
- `backend/migrations/003-user-management.sql` (NEW)
- `backend/src/middleware/requireRole.js` (NEW)
- `backend/src/services/passwords.js` (NEW)
- `backend/src/routes/admin-users.js` (NEW)
- `backend/src/routes/auth.js` (modified)
- `backend/src/server.js` (modified — registers the new route)
- `backend/scripts/create-account.js` (modified)
- `frontend/api-client.js` (modified)
- `frontend/users-admin.html` (NEW)
- `frontend/change-password.html` (NEW)
- `frontend/clpd-portal.html` (modified — login flow)
- `frontend/index.html` (modified — login flow)
- `frontend/lad-admin.html` (modified — adds Users link to nav)
- `frontend/firm-compliance-portal.html` (modified — adds Users link to nav)

### 2. Apply the migration in Render

Once Render shows the new deploy as "Live":

1. Open Render → `lad-clpd-backend` → **Shell** (left sidebar)
2. Wait for the prompt
3. Run:
   ```bash
   node scripts/migrate.js
   ```
4. You should see something like:
   ```
   applying: 003-user-management.sql
   ✓ applied 003-user-management.sql
   ```

The migration runner is idempotent — running it again does nothing.

### 3. Create your super admin account

Still in the Render Shell:

```bash
node scripts/create-account.js \
  --role lad_super_admin \
  --email nasir.khamlichi@legal.dubai.gov.ae \
  --password "lad@2026" \
  --first "Nasir" \
  --last "Khamlichi" \
  --must-change-password
```

You'll see:
```
✓ Created staff: nasir.khamlichi@legal.dubai.gov.ae  (id=S-XXXXXXXX, role=lad_super_admin, must change pw)
```

### 4. Sign in for the first time

1. Go to `https://legalaffairsmain.netlify.app`
2. Click **Sign in** → pick **LAD Admin** (the staff/back-office option)
3. Email: `nasir.khamlichi@legal.dubai.gov.ae`
4. Password: `lad@2026`
5. You'll be redirected to the **Change your password** screen
6. Enter `lad@2026` as the current password, set a strong new one
7. You land on the LAD Admin portal
8. Click **Users** in the top nav to open the User Management page

### 5. Verify everything works

From the User Management page, as super admin:

- **Add a user** — try creating a test lawyer in F001 (Demo Law Firm). Leave password blank to auto-generate. Note the password shown after creation.
- **Sign out**, sign in as that test lawyer with the generated password. You should see the change-password screen.
- **Set a new password**, land in the lawyer portal.
- **Sign out**, sign back in as your super admin. Find the test lawyer in the list. Click **Reset pw** — note the new password shown.
- **Suspend the test lawyer**. Try signing in as them — should fail.
- **Reactivate**. Should work again.

If all of that works, the feature is live.

## Permissions matrix (for reference)

|                                          | Super Admin | LAD Admin | Firm CO |
|------------------------------------------|:-:|:-:|:-:|
| List lawyers                             | ✓ | ✓ | own firm only |
| List firm COs                            | ✓ | ✓ | — |
| List LAD staff                           | ✓ | ✓ | — |
| List LAD admins                          | ✓ | — | — |
| List super admins                        | ✓ | — | — |
| Create lawyer                            | ✓ | ✓ | own firm only |
| Create firm CO                           | ✓ | ✓ | — |
| Create LAD staff                         | ✓ | ✓ | — |
| Create LAD admin                         | ✓ | — | — |
| Create super admin                       | ✓ | — | — |
| Reset password (non-admin)               | ✓ | ✓ | own firm lawyers only |
| Reset password (admin)                   | ✓ | — | — |
| Suspend / reactivate (non-admin)         | ✓ | ✓ | own firm lawyers only |
| Suspend / reactivate (admin)             | ✓ | — | — |
| Change a user's role                     | ✓ | — | — |

## Future enhancements (not in this release)

- Bulk import from CSV (for migrating existing lawyer data)
- Per-user activity log (last 50 actions)
- Email notifications when passwords are reset
- 2FA / TOTP for admin accounts
- Lockout after N failed login attempts

## Rollback

If something breaks in production:

1. Revert the commit in GitHub (`git revert <commit-sha>` then push)
2. Both Render and Netlify will auto-deploy the previous version (~3 min total)
3. The migration cannot be rolled back automatically — but it's purely additive (only adds columns with defaults), so the previous code still works against the new schema. No data loss.
