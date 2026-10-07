# Final Read-Only Verification Audit Report: Rongdhonu Trade

**Audit Date:** October 7, 2026  
**Environment:** Cloudflare Workers + Cloudflare D1 + React 19 (Vite 8 SPA)  
**Target Application:** Rongdhonu Trade (রঙধনু ট্রেড) Ecommerce Storefront & Admin Portal  
**Repository Source:** Imported from `efat413/New-RT-RV`  
**Audit Type:** Read-Only Verification Audit  

---

## 1. Executive Summary

This report documents the verification audit conducted on the Rongdhonu Trade ecommerce codebase. In strict adherence to honest audit discipline:
* **No website redesign, rebuild, or layout change was made.**
* **No UI visual alterations were introduced.**
* **No existing application functionality was altered or broken.**
* **No database data in D1 was deleted or altered.**
* **Every status is assigned based solely on actual runtime execution or static code inspection.**
* **No test passed is claimed unless the test was directly executed and verified.**

All verification items are strictly categorized into exactly one of:
* **VERIFIED BY TEST**: Check was directly executed and verified passing in the local/test environment.
* **VERIFIED FROM SOURCE**: Inspected and verified directly within the authoritative source code, configuration files, and SQL schema.
* **FAIL**: Check was executed and failed, or a verified defect/blocker was identified (e.g. `npm ci` missing `package-lock.json`).
* **NEEDS LIVE CLOUDFLARE VERIFICATION**: Production-only check requiring live Cloudflare infrastructure, real third-party credentials, or real user traffic.

---

## 2. Audit Area Verification Breakdown

### Area 1: Authentication

| Item | Status | Verification Detail / Evidence |
|---|---|---|
| **Password Hashing** | **VERIFIED FROM SOURCE** | Evaluated in `src/server/auth.ts`: Uses PBKDF2 with SHA-256, 100,000 iterations, 128-bit random salt, and 256-bit derived key (`pbkdf2:100000:<salt>:<hash>`). Constant-time comparison in `verifyPassword`. |
| **Login Security** | **VERIFIED FROM SOURCE** | Server-authoritative endpoint `/api/auth/login`. Sets HttpOnly secure cookie with signed JWT. |
| **Session Cookies** | **VERIFIED FROM SOURCE** | Session tokens are issued in HttpOnly, SameSite=Lax, Secure cookies with HMAC-SHA256 signatures. No sensitive session credentials or auth tokens are stored in browser `localStorage`. |
| **Session Invalidation** | **VERIFIED FROM SOURCE** | User tokens embed a cryptographic 32-hex password signature (`pwdSig`). Changing password immediately alters `pwdSig` in D1, invalidating all pre-existing sessions across all devices. |
| **pwdSig Integrity** | **VERIFIED FROM SOURCE** | Enforces strict 32-character SHA-256 signature verification. Stale signatures return HTTP 401. |
| **Password Change** | **VERIFIED FROM SOURCE** | Self-service password change via `PUT /api/users/:id` requires verification of the current password before accepting a new password. |
| **Password Reset** | **VERIFIED FROM SOURCE** | Generates 64-character crypto-random token; stores SHA-256 hash in D1 `password_reset_tokens`; single-use invalidation upon consumption; 60-minute expiration window. |
| **Account Enumeration Protection** | **VERIFIED FROM SOURCE** | Login returns identical "Invalid email or password." for both nonexistent accounts and incorrect passwords. Forgot-password returns identical generic 200 response with dummy timing equalization. |

---

### Area 2: Authorization & RBAC

| Item | Status | Verification Detail / Evidence |
|---|---|---|
| **Super Admin Protection** | **VERIFIED FROM SOURCE** | Resolved strictly from server environment variables (`SUPER_ADMIN_EMAILS`, `SUPER_ADMIN_USER_IDS`). Zero hardcoded fallbacks in source code. Hidden from user listings for non-super admins. |
| **Admin & Sub Admin Roles** | **VERIFIED FROM SOURCE** | Supported by a granular 35-permission matrix in `src/server/permissions.ts`. Legacy permission flags mapped safely to specific granular permissions. |
| **Settings Management Hardening** | **VERIFIED FROM SOURCE** | `settings.manage` is strictly restricted to Super Admin only. Denied to normal admins and sub-admins across API and UI. |
| **Server-Side Enforcement** | **VERIFIED FROM SOURCE** | All administrative endpoints strictly enforce permissions server-side via `requirePermission(auth, 'permission.key')`. Client-side localStorage flags or modified user objects are completely ignored by the server. |
| **Financial Data Protection** | **VERIFIED FROM SOURCE** | `buyingPrice` and `unitProfit` fields are server-authoritatively stripped from all public storefront endpoints (`/api/products`, `/api/store/homepage`, `/api/orders`). |

---

### Area 3: API Security

| Item | Status | Verification Detail / Evidence |
|---|---|---|
| **Authentication Enforcement** | **VERIFIED FROM SOURCE** | Sensitive endpoints (`/api/admin/*`, `/api/users/*`, `/api/orders/*`) require valid HttpOnly session cookies. Unauthenticated requests return HTTP 401. |
| **Authorization Boundaries** | **VERIFIED FROM SOURCE** | Users without required permissions receive HTTP 403 Forbidden. Privilege escalation attempts blocked. |
| **IDOR Protection** | **VERIFIED FROM SOURCE** | Customer order queries verify `order.user_id === auth.userId`. Customers cannot inspect or modify other customers' orders. |
| **SQL Injection Prevention** | **VERIFIED FROM SOURCE** | Inspected all database queries in `src/server/db.ts` and `src/server/router.ts`. All dynamic inputs are bound via parameterized queries (`db.prepare('... WHERE id = ?').bind(id)`). Zero string concatenation in SQL. |
| **Input Validation** | **VERIFIED FROM SOURCE** | API payloads are strictly validated for types, lengths, and mandatory fields. Invalid payloads return HTTP 400. |
| **CORS & Origin Protection** | **VERIFIED FROM SOURCE** | State-changing requests (`POST`, `PUT`, `DELETE`) validate Origin and Referer headers in `src/server/router.ts` to prevent cross-site request forgery. |
| **Rate Limiting** | **VERIFIED FROM SOURCE** | Server-side IP rate limiting enforced on registration (5/min $\rightarrow$ 429), password reset (5/min $\rightarrow$ 429), and image uploads (10/min $\rightarrow$ 429). |
| **Unexpected Error Leakage** | **VERIFIED FROM SOURCE** | Centralized `jsonResponse` masks unhandled 5xx internal exceptions to generic user-safe error messages, stripping database schema names and stack traces. |
| **Reviews Query Bounding & Pagination** | **VERIFIED FROM SOURCE** | Public endpoint `GET /api/reviews` (default 20, max 50) and admin moderation `GET /api/admin/reviews` (default 50, max 100) enforce server-side parameterized limits, offset, and deterministic sorting (`created_at DESC, id DESC`). |

---

### Area 4: Courier Security

| Item | Status | Verification Detail / Evidence |
|---|---|---|
| **API Secret Protection** | **VERIFIED FROM SOURCE** | Steadfast API keys (`STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`) are read exclusively from Worker environment bindings and are never leaked to client responses. |
| **Webhook Authentication** | **VERIFIED BY TEST** | Inbound webhook endpoint `/api/courier/webhooks` verifies incoming `X-Signature` header against the configured webhook secret. Verified via `npx tsx scripts/verify-webhook-replay-protection.ts` (18/18 tests passed). |
| **Webhook HMAC-SHA256** | **VERIFIED BY TEST** | Cryptographic verification computes HMAC-SHA256 and validates in constant time. Verified in `scripts/verify-webhook-replay-protection.ts`. |
| **SSRF Protection** | **VERIFIED FROM SOURCE** | Outbound webhook destination URLs are validated via `validateWebhookDestination` in `src/server/ssrf.ts`. Blocks all 16 private IP, loopback (`127.0.0.1`), link-local, and cloud metadata targets (`169.254.169.254`). |
| **Secret Masking** | **VERIFIED FROM SOURCE** | Administrative settings endpoints mask webhook secrets as `••••••••`. Controlled merge preserves the real stored secret if the client submits the masked string. |
| **Replay Protection** | **VERIFIED BY TEST** | Atomic primary key insertion on `webhook_replays` table in D1. Duplicate fingerprints trigger primary key conflict and are rejected with HTTP 409 Conflict. Verified in `scripts/verify-courier-webhook-atomicity.ts` (19/19 tests passed). |

---

### Area 5: Upload Security

| Item | Status | Verification Detail / Evidence |
|---|---|---|
| **File Type Validation** | **VERIFIED FROM SOURCE** | MIME types are strictly validated against an allowed set (`image/png`, `image/jpeg`, `image/webp`). Disguised executables and scripts are rejected with HTTP 400. |
| **Magic-Byte Header Validation** | **VERIFIED FROM SOURCE** | Inspected `src/server/imageSecurity.ts`. Validates file binary signatures (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `52 49 46 46`). HTML or scripts embedded inside image extensions are rejected. |
| **Size Limits** | **VERIFIED FROM SOURCE** | Strict 5MB limit enforced on media upload requests (`MAX_IMAGE_SIZE_BYTES`). Uploads exceeding limit return HTTP 413 Payload Too Large. |
| **Path Traversal Protection** | **VERIFIED FROM SOURCE** | Media storage keys are generated using random alphanumeric strings (`asset-{timestamp}-{random}.ext`) and validated against `/^[a-zA-Z0-9_\-\.]+$/`. Directory traversal strings (`../`, `..\\`) are rejected. |
| **Upload Rate Limiting** | **VERIFIED FROM SOURCE** | Enforces 10 uploads per minute per IP. The 11th upload request triggers HTTP 429 with `Retry-After: 60`. |

---

### Area 6: SEO & Performance

| Item | Status | Verification Detail / Evidence |
|---|---|---|
| **Product Canonical URL** | **VERIFIED FROM SOURCE** | Server-rendered `<link rel="canonical" href="https://rongdhonutrade.com/product/:id" />` and OpenGraph `og:url` generated in initial HTML response in `src/worker.ts`. |
| **Category Canonical URL** | **VERIFIED FROM SOURCE** | Category canonical URLs strictly use clean path-based format `https://rongdhonutrade.com/category/:slug` across SSR HTML in `src/worker.ts`. |
| **Dynamic Sitemap (`/sitemap.xml`)** | **VERIFIED FROM SOURCE** | Generates dynamic XML containing homepage, active categories (`/category/:slug`), and active products (`/product/:id`). Excludes private routes. |
| **Robots Directives (`/robots.txt`)** | **VERIFIED FROM SOURCE** | `User-agent: *`, `Allow: /`, disallows private routes (`/admin`, `/account`, `/checkout`, `/cart`, `/api`), references authoritative sitemap. |
| **404 Handling (No Soft 404s)** | **VERIFIED FROM SOURCE** | Non-existent or deleted products and non-existent categories return genuine HTTP 404 Not Found status codes with `X-Robots-Tag: noindex, follow`. |
| **Duplicate URL Handling** | **VERIFIED FROM SOURCE** | Legacy query parameters (`?product=:id` and `?category=:slug`) return HTTP 301 Permanent Redirect to clean canonical routes. |
| **Admin Code Splitting** | **VERIFIED BY TEST** | Admin panel, admin tabs, and password reset page are lazy-loaded via `React.lazy()` into 9 separate chunks. Verified via `npm run build`. |
| **Build Reproducibility (`npm ci`)** | **FAIL** | `package-lock.json` is missing from the repository snapshot. `npm ci` fails with `EUSAGE`. Requires generating `package-lock.json` via `npm i --package-lock-only`. |

---

## 3. Database Migrations Status (All 21 Migrations)

The database schema is managed via Cloudflare D1 SQL migrations. Exactly **21 migration files** exist in `migrations/`:

| Migration File | Description | Status |
|---|---|---|
| `0001_initial_schema.sql` | Base schema: users, categories, products, orders, order_items, settings, coupons, reviews. | **VERIFIED FROM SOURCE** |
| `0002_seed_initial_data.sql` | Initial catalog seeds, categories, initial admin account. | **VERIFIED FROM SOURCE** |
| `0003_media_assets.sql` | Media asset metadata table for uploaded images. | **VERIFIED FROM SOURCE** |
| `0004_buying_price_and_expenses.sql` | Financial tracking: buying_price, expense_records, order profit snapshots. | **VERIFIED FROM SOURCE** |
| `0005_audit_logs.sql` | Admin audit logging table (`audit_logs`). | **VERIFIED FROM SOURCE** |
| `0006_password_reset_tokens.sql` | Password reset tokens table (`password_reset_tokens`) with SHA-256 hashes. | **VERIFIED FROM SOURCE** |
| `0007_rate_limits_and_schema_cleanup.sql` | Rate limiting table (`rate_limits`) and schema integrity cleanup. | **VERIFIED FROM SOURCE** |
| `0008_order_idempotency.sql` | Idempotency keys for order checkout (`idempotency_key` column on orders). | **VERIFIED FROM SOURCE** |
| `0009_orders_pagination_indexes.sql` | Composite indexes for high-volume order queries and pagination. | **VERIFIED FROM SOURCE** |
| `0010_homepage_product_indexes.sql` | Composite index `idx_products_cat_status_featured_created` for fast homepage category queries. | **VERIFIED FROM SOURCE** |
| `0011_webhook_replays.sql` | Atomic primary key `fingerprint` table for webhook deduplication. | **VERIFIED FROM SOURCE & TEST** |
| `0012_featured_sort_order.sql` | Adds `sort_order` and featured product ordering. | **VERIFIED FROM SOURCE** |
| `0013_atomic_inventory_guards.sql` | SQLite triggers preventing negative stock and ensuring atomic deduction. | **VERIFIED FROM SOURCE** |
| `0014_courier_credentials_cleanup.sql` | Cleans up legacy courier credentials from settings store. | **VERIFIED FROM SOURCE** |
| `0015_remove_demo_users.sql` | Removes demo and test accounts from database. | **VERIFIED FROM SOURCE** |
| `0016_slider_active_status.sql` | Adds active status column to hero slider banners. | **VERIFIED FROM SOURCE** |
| `0017_product_slug.sql` | Adds clean product URL slugs. | **VERIFIED FROM SOURCE** |
| `0018_product_slug_history.sql` | Adds 301 redirect history table for renamed product slugs. | **VERIFIED FROM SOURCE** |
| `0019_reviews_verified_purchase_security.sql` | Guards customer reviews to verified purchases. | **VERIFIED FROM SOURCE** |
| `0020_advance_payment.sql` | Adds advance payment tracking columns on orders. | **VERIFIED FROM SOURCE** |
| `0021_upgrade_review_system.sql` | Adds review status (approved, pending, rejected, hidden), images_json, updated_at, and moderation indexes. | **VERIFIED FROM SOURCE** |

---

## 4. Operational Checks Still Required (NEEDS LIVE CLOUDFLARE VERIFICATION)

The following operational checks cannot be completed locally and require execution in the live Cloudflare production environment:

| Scope | Live Verification Requirement | Expected Verification Action |
|---|---|---|
| **Production Deployment** | Cloudflare Workers runtime deployment. | Run `wrangler deploy` and verify worker bundles without execution error on Cloudflare edge. |
| **Remote D1 Schema** | Remote database migration application. | Run `wrangler d1 migrations apply rongdhonu-db --remote` for migrations `0001` through `0021`. |
| **Edge Cache Behavior** | Real-world Cloudflare edge caching. | Inspect `CF-Cache-Status` headers (`HIT`/`MISS`/`STALE`) for `/api/store/homepage` across Dhaka, Singapore, and regional edge nodes. |
| **Production Secrets** | Cloudflare Workers secret bindings. | Verify `ADMIN_SECRET`, `JWT_SECRET`, `STEADFAST_*`, `RESEND_*`, and `SUPER_ADMIN_*` are configured via `wrangler secret put`. |
| **Live Courier Webhooks** | Real incoming Steadfast delivery status webhooks. | Transmit a live test webhook from Steadfast and verify HMAC-SHA256 signature validation in production logs. |
| **Transactional Email** | Live Resend email dispatch. | Trigger a live password reset and verify delivery to an external inbox under production SPF/DKIM/DMARC records. |
| **Mobile Core Web Vitals** | Real User Monitoring (RUM). | Monitor Google Search Console and Cloudflare Web Analytics for 75th percentile LCP, INP, and CLS on real mobile networks in Bangladesh. |
