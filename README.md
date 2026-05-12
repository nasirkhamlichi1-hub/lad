# LAD CLPD — production bundle

The Dubai Legal Affairs Department Continuing Legal Professional Development platform.

This bundle contains everything needed to deploy the platform to production:

```
.
├── backend/                  Node.js + SQLite API
│   ├── src/                  Express app, validation, structured logs
│   ├── migrations/           Versioned schema migrations
│   ├── scripts/              bootstrap.sh, migrate.js, seed.js
│   ├── Dockerfile            Multi-stage, non-root, health-checked
│   └── package.json
├── frontend/                 Static HTML/CSS/JS, Netlify-ready
│   ├── runtime-config.js     One file to point at staging vs production
│   ├── *.html                Portal pages per role
│   └── netlify.toml          Friendly URLs + CSP + caching
├── .github/workflows/
│   ├── backend.yml           Build & push container on every push to main
│   └── frontend.yml          Deploy to Netlify on every push to main
├── render.yaml               One-click Render deploy (staging)
├── PRODUCTION.md             ← The runbook. Read this.
└── README.md                 This file
```

## First-time setup

1. **Read `PRODUCTION.md`.** It lists every step, what's automated, and what requires a human.
2. Complete the **irreducible manual steps** (UAE Pass onboarding, domain, cloud account) — these run in parallel with development.
3. Push this repo to GitHub. CI will build the backend container on the first push to `main`.
4. Connect Render (staging) or Azure Container Apps (production) to the repo / GHCR image.
5. Connect Netlify to the repo for the frontend.
6. Fill in secrets in the cloud dashboards (listed in `PRODUCTION.md` §2.3).
7. Edit `frontend/runtime-config.js` to point at your backend URL; commit; auto-deploy.

That's the whole flow.

## Local development

```sh
# Backend
cd backend
./scripts/bootstrap.sh     # installs deps, creates .env, runs migrations
npm start

# Frontend (in a separate terminal — any static server works)
cd frontend
python3 -m http.server 8080
# or: npx serve .
```

The default `.env` runs everything in demo mode (no UAE Pass, no Anthropic). Edit `.env` to wire in real services.

## Support

- Issues: open in this repo
- Backend health: `GET /api/v1/health`
- Logs: JSON one-liners in production, parseable by any log aggregator
- Rollback: see `PRODUCTION.md` §6
