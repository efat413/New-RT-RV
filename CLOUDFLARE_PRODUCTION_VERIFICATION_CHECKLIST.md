# Cloudflare Production Deployment Verification Checklist: Rongdhonu Trade

**Audit Date:** October 7, 2026  
**Target Environment:** Cloudflare Workers + Cloudflare D1 + Static Assets (`rongdhonutrade`)  
**Repository:** Rongdhonu Trade (রঙধনু ট্রেড) — `efat413/New-RT-RV`  

---

## 1. Classification Methodology

In strict compliance with verification audit discipline:
- **VERIFIED FROM SOURCE**: Inspected and verified directly within the authoritative source code, configuration files, and SQL schema.
- **VERIFIED BY TEST**: Executed and verified via automated test suites (`npx tsx scripts/*`, `npm run lint`, `npm run build`, or command execution).
- **REQUIRES LIVE CLOUDFLARE VERIFICATION**: Requires live Cloudflare infrastructure, active Cloudflare credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), live D1 remote binding execution, live external webhook transmission, or real user traffic.
- **NOT APPLICABLE**: Feature or configuration not used or applicable to this deployment architecture.

> **CRITICAL REPRODUCIBILITY NOTE (npm ci):**  
> In the current repository snapshot, `package-lock.json` is **absent** (a `bun.lock` artifact exists from source repository import). Consequently, running `npm ci` fails with `npm error code EUSAGE (ENOLOCK)`. To ensure GitHub Actions CI/CD (`.github/workflows/deploy.yml`) succeeds deterministically, `package-lock.json` must be generated (`npm i --package-lock-only`) and committed.

---

## 2. 25-Point Cloudflare Production Verification Matrix

| # | Verification Item | Classification | Verification Detail & Source Evidence |
|---|---|---|---|
| **1** | **Cloudflare Worker deployment configuration** | **VERIFIED FROM SOURCE**<br>*(Deployment execution: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | `wrangler.json` specifies `"name": "rongdhonutrade"`, `"main": "src/worker.ts"`, `"compatibility_date": "2024-09-23"`, `"compatibility_flags": ["nodejs_compat"]`, `"assets": { "directory": "./dist", "binding": "ASSETS", "not_found_handling": "none" }`, and `"build": { "command": "npm run build", "watch_dir": "src" }`. Bundle generation validated via `npm run build`. Live deployment requires Cloudflare credentials. |
| **2** | **Environment variables** | **VERIFIED FROM SOURCE** | `wrangler.json` defines non-sensitive public variables under `"vars"`: `APP_URL: "https://rongdhonutrade.com"`, `RESEND_FROM_EMAIL: "support@rongdhonutrade.com"`, and `SUPER_ADMIN_EMAILS: "cmt413uec@gmail.com"`. Matches definitions in `.env.example` and `.dev.vars.example`. |
| **3** | **Secrets** | **VERIFIED FROM SOURCE**<br>*(Secret provisioning: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | Server-authoritative code (`src/server/auth.ts`, `src/server/courier.ts`, `src/server/webhookAuth.ts`) reads `ADMIN_SECRET`, `JWT_SECRET`, `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`, `COURIER_WEBHOOK_SECRET`, `RESEND_API_KEY`, and `SUPER_ADMIN_USER_IDS` strictly from worker `env`. Fail-closed behavior enforced if required secrets are missing in production. Storing production secrets requires `wrangler secret put <KEY>`. |
| **4** | **D1 database binding** | **VERIFIED FROM SOURCE**<br>*(Remote database execution: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | `wrangler.json` declares D1 binding: `binding: "DB"`, `database_name: "rongdhonu-db"`, `database_id: "3276795d-5593-42c0-8e14-947f3ab1172b"`, and `migrations_dir: "migrations"`. Handled in `src/worker.ts`, `src/server/router.ts`, and `src/server/db.ts` via `env.DB`. |
| **5** | **D1 migrations** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST**<br>*(Remote apply: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | Exactly 21 migration files exist in `migrations/` (`0001_initial_schema.sql` through `0021_upgrade_review_system.sql`). Migration SQL syntax and trigger integrity verified. Applying to remote Cloudflare D1 requires `wrangler d1 migrations apply rongdhonu-db --remote` (or `npm run d1:migrate`). |
| **6** | **Production database schema** | **VERIFIED FROM SOURCE** | Authoritative tables defined across `schema.sql` and `migrations/*.sql`: `users`, `categories`, `products`, `orders`, `order_items`, `settings`, `coupons`, `reviews`, `media_assets`, `expense_records`, `audit_logs`, `password_reset_tokens`, `rate_limits`, `webhook_replays`, `product_slug_history`. Database triggers: `trg_prevent_negative_stock` and `trg_prevent_negative_stock_insert`. |
| **7** | **Worker routes** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | `src/worker.ts` routes `/api/*` to `handleApiRequest`, `/robots.txt` to `ROBOTS_TXT_CONTENT`, `/sitemap.xml` to dynamic sitemap generated from D1, `/product/:id` and `/category/:slug` to SSR HTML with 301 redirects for legacy query parameters, valid SPA routes (`/`, `/admin`, `/account`, `/cart`, `/checkout`, `/tracking`, `/reset-password`) to static `index.html` via `env.ASSETS`, arbitrary missing routes to custom 404 HTML, and static assets via `env.ASSETS.fetch(request)`. |
| **8** | **CORS behavior** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Configured in `src/server/securityHeaders.ts` and `src/server/router.ts`. Whitelists `PRODUCTION_ORIGIN` (`https://rongdhonutrade.com`), `https://www.rongdhonutrade.com`, `ALLOWED_ORIGINS`, and local dev origins. Preflight `OPTIONS` handled cleanly (204/403). State-changing methods (`POST`, `PUT`, `DELETE`, `PATCH`) validate `Origin`/`Referer`. Wildcard `*` never allowed on authenticated endpoints. Verified in `scripts/verify-security-hardening.ts`. |
| **9** | **Security headers** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Evaluated in `src/server/securityHeaders.ts` and `src/worker.ts`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Verified in `scripts/verify-security-hardening.ts`. |
| **10** | **CSP (Content Security Policy)** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Configured in `src/server/securityHeaders.ts` and `public/_headers`. Restricts `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, and `upgrade-insecure-requests`. Explicitly whitelists analytics and tracking domains (Google Analytics, GTM, Meta Pixel, TikTok Pixel) with SHA-256 inline hash (`'sha256-AjqrFSwlY5H5Xu7BDNjDp96JBtKMjTBx0PeEEAXqxn0='`). No `'unsafe-inline'` in script-src. Media responses serve isolated `default-src 'none'`. Verified in `scripts/verify-security-hardening.ts`. |
| **11** | **Cache-Control headers** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST**<br>*(CDN hit ratio: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | Storefront homepage `/api/store/homepage` and reviews `/api/reviews` serve `public, max-age=30, s-maxage=60, stale-while-revalidate=30`. Dynamic/admin/auth endpoints serve `no-store, no-cache, must-revalidate, private`. Static hashed bundles in `/assets/` and media `/api/media/:key` serve `public, max-age=31536000, immutable`. Verified in `scripts/verify-cloudflare-caching.ts` and `scripts/verify-homepage-performance.ts`. |
| **12** | **Authentication cookies** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Auth token issued as `auth_token` cookie upon login (`POST /api/auth/login`) and cleared upon logout (`POST /api/auth/logout`). Bearer token fallback supported for API clients. Verified in `src/server/auth.ts` and `scripts/verify-auth-security-fixes.ts`. |
| **13** | **Secure / HttpOnly / SameSite cookie attributes** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Auth cookie options in `src/server/auth.ts` enforce `HttpOnly`, `Path=/`, `SameSite=Lax`, and `Secure` (in HTTPS/production). Incorporates 32-hex `pwdSig` (128-bit SHA-256 hash digest) for deterministic session invalidation upon password modification. Verified in `scripts/verify-auth-security-fixes.ts`. |
| **14** | **Upload limits** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Enforced in `src/server/router.ts`: 10MB router image cap (`MAX_IMAGE_SIZE_BYTES`) with R2 authoritative storage, review image cap (2MB `MAX_REVIEW_IMAGE_BYTES`), sliding-window rate limit (10 uploads/min per IP), binary magic-byte inspection (`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/x-icon`), SVG prohibition across all upload flows, and alphanumeric key sanitization preventing directory traversal (`../`). Verified in `scripts/verify-upload-rate-limit.ts` and `scripts/verify-image-upload-contract-consistency.ts`. |
| **15** | **Webhook configuration** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Endpoints `/api/courier/webhooks`, `/api/webhook/steadfast`, and `/api/webhook/courier` in `src/server/router.ts`. Deduplication handled atomically via primary key conflict on `webhook_replays` table in D1. Cron trigger in `src/worker.ts` syncs active orders every 15 minutes. Verified in `scripts/verify-courier-webhook-atomicity.ts`. |
| **16** | **Webhook secrets** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST**<br>*(Live Steadfast webhooks: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | Inbound courier webhooks authenticated via HMAC-SHA256 signature in `src/server/webhookAuth.ts` matching `COURIER_WEBHOOK_SECRET` or `STEADFAST_SECRET_KEY`, with 5-minute timestamp tolerance window. Secrets masked as `••••••••` in settings responses with controlled merge on update. Verified in `scripts/verify-courier-webhook-security.ts`. |
| **17** | **Payment configuration** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Cash on Delivery (COD) calculations and advance payments (DBBL NexusPay, Bkash, Nagad) verified in `src/server/router.ts`. Order totals, product prices, discounts, and delivery fees strictly recalculated server-side from D1. Unauthenticated or guest order advance payments reset to 0 to prevent advance payment spoofing. Verified in `scripts/verify-final-advance-payment-suite.ts`. |
| **18** | **Error handling** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Centralized `jsonResponse` in `src/server/router.ts` and worker root catch block in `src/worker.ts` mask 500 errors to generic message (`"Internal server error."`), preventing leakage of database schema, SQL queries, or stack traces. Malformed JSON safely returns HTTP 400. Verified in `scripts/verify-safe-error-handling.ts`. |
| **19** | **Rate limiting** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Database-backed IP sliding-window rate limits via `rate_limits` table in D1: Login (5/15m), Password Reset (5/15m), Uploads (10/1m), Orders (10/10m), Reviews (5/10m). Verified in `scripts/verify-login-rate-limiting.ts`, `scripts/verify-password-reset-system.ts`, and `scripts/verify-upload-rate-limit.ts`. |
| **20** | **Production logging** | **VERIFIED FROM SOURCE** | `wrangler.json` enables Cloudflare Workers Observability (`"observability": { "enabled": true }`). Administrative mutations logged to `audit_logs` table in D1. Critical errors logged via `console.error` with credentials, tokens, and secrets redacted. |
| **21** | **Source maps / debug information** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | `vite.config.ts` explicitly configures `build.sourcemap: false`. In `dist/assets/`, zero `.map` files are generated. Debug response headers (`X-Image-Transform`, `X-Image-Width`) removed from production responses. Verified via `npm run build`. |
| **22** | **GitHub Actions deployment** | **VERIFIED FROM SOURCE**<br>*(Pipeline execution: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | `.github/workflows/deploy.yml` enforces least-privilege `contents: read`, concurrency grouping, Node 22 runtime, `npm ci`, linting, security test suites execution, `npm run build`, remote D1 migration apply, and `wrangler deploy` gated strictly to `main` branch pushes. Pipeline execution requires repository secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and committed `package-lock.json`. |
| **23** | **Node/npm version consistency** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | `package.json` specifies `"engines": { "node": ">=22.0.0", "npm": ">=10.0.0" }`. `.github/workflows/deploy.yml` specifies `node-version: '22'`. Local verification environment runs Node.js `v22.23.2` and npm `10.9.8`. |
| **24** | **npm ci reproducibility** | **VERIFIED BY TEST (CURRENTLY FAILING / LOCKFILE MISSING)** | Direct execution of `npm ci` fails with `npm error code EUSAGE` because `package-lock.json` is **not present** in the current repository snapshot (a `bun.lock` exists). To enable deterministic `npm ci` builds in CI/CD, `package-lock.json` must be generated (`npm i --package-lock-only`) and committed to the repository. |
| **25** | **Build output** | **VERIFIED BY TEST** | Executed `npm run build` (`vite build`). Clean production build produced in `dist/` with 1725 modules transformed, hashed asset bundles, 9 lazy-loaded admin chunks, and zero build errors. |

---

## 3. Concise Production-Readiness Checklist

Before routing production traffic on Cloudflare, perform the following operational steps:

- [ ] **Step 1: Generate & Commit `package-lock.json` for CI/CD Reproducibility**  
  In the repository root, run:
  ```bash
  npm i --package-lock-only
  git add package-lock.json
  git commit -m "chore: add authoritative package-lock.json for npm ci reproducibility"
  ```

- [ ] **Step 2: Configure Cloudflare Worker Secrets**  
  Execute via Wrangler CLI:
  ```bash
  npx wrangler secret put ADMIN_SECRET
  npx wrangler secret put JWT_SECRET
  npx wrangler secret put STEADFAST_API_KEY
  npx wrangler secret put STEADFAST_SECRET_KEY
  npx wrangler secret put COURIER_WEBHOOK_SECRET
  npx wrangler secret put RESEND_API_KEY
  npx wrangler secret put SUPER_ADMIN_USER_IDS
  ```

- [ ] **Step 3: Apply All 21 Remote D1 Migrations**  
  Execute against the remote production Cloudflare D1 database:
  ```bash
  npx wrangler d1 migrations apply rongdhonu-db --remote
  ```
  *(Or run `npm run d1:migrate`)*

- [ ] **Step 4: Deploy Worker & Static Assets**  
  Deploy the application:
  ```bash
  npm run deploy
  ```

- [ ] **Step 5: Verify Remote Health & Observability**  
  Verify the public health check endpoint returns 200 OK:
  ```bash
  curl -i https://rongdhonutrade.com/api/health
  ```

- [ ] **Step 6: Verify Edge Caching & Security Headers**  
  Inspect `CF-Cache-Status` and security headers on the storefront homepage:
  ```bash
  curl -i https://rongdhonutrade.com/api/store/homepage
  ```
  Check for:
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=30`

- [ ] **Step 7: Transmit Live Steadfast Courier Test Webhook**  
  Send a signed test payload to `https://rongdhonutrade.com/api/courier/webhooks` with `X-Signature` and verify status code 200 in Cloudflare Worker Observability logs.

- [ ] **Step 8: Verify Live Transactional Email Deliverability**  
  Request a password reset on `https://rongdhonutrade.com/account/login` and verify email arrival from `support@rongdhonutrade.com` via Resend with valid SPF/DKIM/DMARC records.
