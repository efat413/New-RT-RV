# Cloudflare Production Deployment Verification Checklist: Rongdhonu Trade

**Audit Date:** October 7, 2026  
**Target Environment:** Cloudflare Workers + Cloudflare D1 + Static Assets (`rongdhonutrade`)  
**Repository:** Rongdhonu Trade (রঙধনু ট্রেড)  

---

## 1. Classification Methodology

In strict compliance with verification audit discipline:
- **VERIFIED FROM SOURCE**: Inspected and verified directly within the authoritative source code, configuration files, and SQL schema.
- **VERIFIED BY TEST**: Executed and verified via automated test suites (`npx tsx scripts/*`, `npm run lint`, `npm run build`, `npm ci`, or `npm audit`).
- **REQUIRES LIVE CLOUDFLARE VERIFICATION**: Requires live Cloudflare infrastructure, active Cloudflare credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), live D1 remote binding execution, live external webhook transmission, or real user traffic.
- **NOT APPLICABLE**: Feature or configuration not used or applicable to this deployment architecture.

---

## 2. 25-Point Cloudflare Production Verification Matrix

| # | Verification Item | Classification | Verification Detail & Source Evidence |
|---|---|---|---|
| **1** | **Cloudflare Worker deployment configuration** | **VERIFIED FROM SOURCE**<br>*(Deployment execution: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | `wrangler.json` specifies `"name": "rongdhonutrade"`, `"main": "src/worker.ts"`, `"compatibility_date": "2024-09-23"`, `"compatibility_flags": ["nodejs_compat"]`, `"assets": { "directory": "./dist", "binding": "ASSETS", "not_found_handling": "none" }`, and `"build": { "command": "npm run build", "watch_dir": "src" }`. Bundle generation validated via `npm run build`. |
| **2** | **Environment variables** | **VERIFIED FROM SOURCE** | `wrangler.json` defines non-sensitive public variables under `"vars"`: `APP_URL: "https://rongdhonutrade.com"`, `RESEND_FROM_EMAIL: "support@rongdhonutrade.com"`, and `SUPER_ADMIN_EMAILS: "cmt413uec@gmail.com"`. Matches `.env.example` and `.dev.vars.example`. |
| **3** | **Secrets** | **VERIFIED FROM SOURCE**<br>*(Provisioning: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | Server-authoritative code (`src/server/auth.ts`, `src/server/courier.ts`, `src/server/webhookAuth.ts`) reads `ADMIN_SECRET`, `JWT_SECRET`, `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`, `COURIER_WEBHOOK_SECRET`, `RESEND_API_KEY`, and `SUPER_ADMIN_USER_IDS` strictly from worker `env`. Fail-closed behavior enforced if required secrets are missing in production. Storing production secrets requires `wrangler secret put <KEY>`. |
| **4** | **D1 database binding** | **VERIFIED FROM SOURCE** | `wrangler.json` declares D1 binding: `binding: "DB"`, `database_name: "rongdhonu-db"`, `database_id: "3276795d-5593-42c0-8e14-947f3ab1172b"`, and `migrations_dir: "migrations"`. `src/server/router.ts` and `src/server/db.ts` interact with `env.DB`. |
| **5** | **D1 migrations** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST**<br>*(Remote apply: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | Exactly 21 migration files exist in `migrations/` (`0001_initial_schema.sql` through `0021_upgrade_review_system.sql`). Migration SQL syntax and incremental changes parsed and tested locally. Applying to remote Cloudflare D1 requires `wrangler d1 migrations apply rongdhonu-db --remote`. |
| **6** | **Production database schema** | **VERIFIED FROM SOURCE** | Authoritative tables defined across `schema.sql` and migrations: `users`, `categories`, `products`, `orders`, `order_items`, `settings`, `coupons`, `reviews`, `media_assets`, `expense_records`, `audit_logs`, `password_reset_tokens`, `rate_limits`, `webhook_replays`, `product_slug_history`. Composite indexes and foreign keys properly structured. |
| **7** | **Worker routes** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | `src/worker.ts` handles API routes (`/api/*`), sitemap (`/sitemap.xml`), robots (`/robots.txt`), media delivery (`/api/media/*`), SSR meta injection for SEO (`/product/:id`, `/category/:slug`), and falls back to static assets via `env.ASSETS.fetch(request)`. Verified in `scripts/verify-fixes.ts` and `scripts/verify-api-endpoints.ts`. |
| **8** | **CORS behavior** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Configured in `src/server/securityHeaders.ts` and `src/server/router.ts`. Allowed origins: `https://rongdhonutrade.com` (production) and localhost (dev). `OPTIONS` preflight handled cleanly. State-changing methods (`POST`, `PUT`, `DELETE`, `PATCH`) validate `Origin`/`Referer`. Wildcard `*` never allowed on authenticated endpoints. Verified in `scripts/verify-security-hardening.ts`. |
| **9** | **Security headers** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Evaluated in `src/server/securityHeaders.ts`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Verified in `scripts/verify-security-hardening.ts`. |
| **10** | **CSP (Content Security Policy)** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Configured in `CONTENT_SECURITY_POLICY` (`src/server/securityHeaders.ts`). Restricts `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, and `upgrade-insecure-requests`. Explicitly whitelists required external scripts (Google Analytics, GTM, Meta Pixel, TikTok Pixel) with SHA-256 inline hashes. Verified in `scripts/verify-security-hardening.ts`. |
| **11** | **Cache-Control headers** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST**<br>*(Edge hit ratio: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | Storefront homepage `/api/store/homepage` and reviews `/api/reviews` serve `public, max-age=30, s-maxage=60, stale-while-revalidate=30`. Dynamic/admin/auth endpoints serve `no-store, no-cache, must-revalidate, private`. Static assets use immutable caching. Verified in `scripts/verify-cloudflare-caching.ts` and `scripts/verify-homepage-performance.ts`. |
| **12** | **Authentication cookies** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Auth token issued as `auth_token` cookie upon login (`POST /api/auth/login`) and cleared upon logout (`POST /api/auth/logout`). Verified in `src/server/auth.ts` and `scripts/verify-auth-security-fixes.ts`. |
| **13** | **Secure / HttpOnly / SameSite cookie attributes** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Auth cookie options in `src/server/auth.ts` enforce `HttpOnly`, `Path=/`, `SameSite=Lax`, and `Secure` (in production). Prevents XSS token exfiltration. Verified in `scripts/verify-auth-security-fixes.ts`. |
| **14** | **Upload limits** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Enforced in `src/server/router.ts`: 10MB maximum request size limit (`MAX_IMAGE_SIZE_BYTES`), sliding-window rate limit (10 uploads/min per IP), magic-byte validation (`image/jpeg`, `image/png`, `image/webp`), and alphanumeric key sanitization preventing path traversal (`../`). Verified in `scripts/verify-upload-rate-limit.ts`. |
| **15** | **Webhook configuration** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Endpoints `/api/courier/webhooks`, `/api/webhook/steadfast`, and `/api/webhook/courier` handle delivery updates in `src/server/router.ts`. Deduplication handled via `webhook_replays` table in D1. Verified in `scripts/verify-courier-webhook-atomicity.ts`. |
| **16** | **Webhook secrets** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST**<br>*(Live verification: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | Verified via `verifyCourierWebhookAuth` in `src/server/webhookAuth.ts`. Requires HMAC-SHA256 signature matching `COURIER_WEBHOOK_SECRET` or bearer secret. Constant-time comparison prevents timing attacks. Secrets masked as `••••••••` in settings responses. Verified in `scripts/verify-courier-webhook-security.ts`. |
| **17** | **Payment configuration** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Cash on Delivery (COD) calculations recalculated server-side. DBBL, Bkash, and Nagad advance payment records verified in `src/server/router.ts`. Guest requests have unverified advance payment amounts reset to 0 to prevent payment spoofing. Verified in `scripts/verify-final-advance-payment-suite.ts`. |
| **18** | **Error handling** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Unhandled server exceptions intercepted by `jsonResponse` in `src/server/router.ts`. Masks 500 errors to user-safe generic messages ("Internal server error.") in production to prevent leaking SQL statements or stack traces. Request bodies parsed safely via `safeParseJson`. Verified in `scripts/verify-safe-error-handling.ts`. |
| **19** | **Rate limiting** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Database-backed IP sliding-window rate limits in `src/server/router.ts` (`rate_limits` table): Login (5/15m), Password Reset (5/15m), Uploads (10/1m), Reviews (5/10m), Checkout Orders (10/10m). Verified in `scripts/verify-login-rate-limiting.ts` and `scripts/verify-upload-rate-limit.ts`. |
| **20** | **Production logging** | **VERIFIED FROM SOURCE** | `wrangler.json` enables Cloudflare Workers Observability (`"observability": { "enabled": true }`). Critical events logged via `console.error` without leaking secrets. Admin mutations recorded in D1 `audit_logs` table. |
| **21** | **Source maps / debug information** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | `vite.config.ts` explicitly sets `build.sourcemap: false`. Verified in `dist/assets/` output—no `.map` files generated, preventing client-side source code reconstruction. |
| **22** | **GitHub Actions deployment** | **VERIFIED FROM SOURCE**<br>*(Run: REQUIRES LIVE CLOUDFLARE VERIFICATION)* | `.github/workflows/deploy.yml` enforces least-privilege `contents: read`, concurrency control, Node 22 setup, `npm ci`, linting, security test suites execution, `npm run build`, remote D1 migration apply, and `wrangler deploy` gated strictly to `main` branch pushes. |
| **23** | **Node/npm version consistency** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | `package.json` specifies `"engines": { "node": ">=22.0.0", "npm": ">=10.0.0" }`. `.github/workflows/deploy.yml` specifies `node-version: '22'`. Current environment runs Node `v22.23.2` and npm `10.9.8`. |
| **24** | **npm ci reproducibility** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | Authoritative `package-lock.json` present (Lockfile v3). Tested via `npm ci`: all 87 packages install cleanly and deterministically. `npm audit` reports 0 vulnerabilities. |
| **25** | **Build output** | **VERIFIED FROM SOURCE** & **VERIFIED BY TEST** | `npm run build` compiles cleanly into `dist/`. Hashed asset filenames, 9 code-split chunks for admin portal and heavy components, asset footprint optimized. Zero build errors. |

---

## 3. Concise Production-Readiness Checklist

Before triggering production traffic on Cloudflare, perform the following operational steps:

- [ ] **Step 1: Set Up Cloudflare Worker Secrets**  
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

- [ ] **Step 2: Apply D1 Remote Migrations**  
  Execute all 21 migrations against the remote production database:
  ```bash
  npx wrangler d1 migrations apply rongdhonu-db --remote
  ```
  *(Or run `npm run d1:migrate`)*

- [ ] **Step 3: Deploy Worker & Static Assets**  
  Deploy the application:
  ```bash
  npm run deploy
  ```

- [ ] **Step 4: Verify Remote Health Endpoint**  
  Verify the public health check endpoint returns 200 OK:
  ```bash
  curl -i https://rongdhonutrade.com/api/health
  ```

- [ ] **Step 5: Verify Live Edge Caching & Headers**  
  Verify `CF-Cache-Status` and security headers on the storefront homepage:
  ```bash
  curl -i https://rongdhonutrade.com/api/store/homepage
  ```
  Check for:
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=30`

- [ ] **Step 6: Transmit Live Steadfast Courier Test Webhook**  
  Send a signed test payload to `https://rongdhonutrade.com/api/courier/webhooks` with `X-Signature` and verify status code 200 in Cloudflare Worker logs.

- [ ] **Step 7: Verify Live Transactional Email**  
  Request a password reset on `https://rongdhonutrade.com/account/login` and verify that the email arrives from `support@rongdhonutrade.com` via Resend with valid SPF/DKIM/DMARC headers.
