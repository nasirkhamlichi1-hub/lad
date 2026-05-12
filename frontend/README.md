# LAD CLPD Frontend

Static HTML/CSS/JavaScript portals for the Dubai Legal Affairs Department's CLPD platform. No build step — every `.html` file is self-contained and runs directly in any modern browser.

## Files

| File | What it is |
|---|---|
| `index.html` / `clpd-portal.html` | Public CLPD landing page — anyone can view |
| `lad-super-system.html` | "CLPD Platform" hub — landing point after login |
| `lawyer-portal-v2.html` | Individual lawyer's CLPD dashboard (Yousef Al Mansouri demo) |
| `firm-compliance-portal.html` | Firm compliance officer view (Galadari demo) |
| `lad-intelligence-v4.html` | LAD analyst dashboard — cross-firm intelligence |
| `lad-admin.html` | LAD course administrator CMS |
| `lad-config.json` | Defaults loaded by the public portals on first visit |
| `api-client.js` | REST client + localStorage fallback |
| `auth-bridge.js` | Captures the JWT from `#token=…` after UAE Pass redirect |
| `netlify.toml` | Netlify configuration |
| `img/` | Hero photos |

## Connecting to the backend

In production, before any portal runs, set the API base URL:

```html
<script>window.LAD_API_BASE = 'https://api.your-domain.ae';</script>
<script src="api-client.js"></script>
<script src="auth-bridge.js"></script>
```

The backend's UAE Pass flow redirects the user's browser back to the frontend with the JWT in the URL fragment (`#token=…&role=…&name=…`); `auth-bridge.js` captures this and stores it in `localStorage.lad_token`. Every subsequent API call goes out with `Authorization: Bearer …`.

If `LAD_API_BASE` is not set, the portals fall back to localStorage with seeded demo data — useful for offline demos.

### Adding login buttons

Any element with `data-lad-login-uaepass` becomes a UAE Pass login trigger; `data-lad-logout` becomes a logout button.

```html
<button data-lad-login-uaepass>Login with UAE Pass</button>
<button data-lad-logout>Sign out</button>
```

## Local development

```bash
python3 -m http.server 8080
# Then open http://localhost:8080/lad-super-system.html
```

## Deploying

### Netlify

```bash
netlify deploy --prod --dir .
```

The included `netlify.toml` redirects `/` to `lad-super-system.html`.

### Azure Static Web Apps

```bash
az staticwebapp create --name lad-clpd --location uaenorth --source . --app-location /
```

## License

Proprietary — Government of Dubai, Legal Affairs Department.
