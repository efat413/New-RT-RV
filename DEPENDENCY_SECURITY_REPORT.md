# Dependency & Build Reproducibility Audit Report
**Target Application:** Rongdhonu Trade (রঙধনু ট্রেড)  
**Date:** October 7, 2026  
**Status:** ⚠️ AUDITED — LOCKFILE GENERATION REQUIRED FOR CI/CD REPRODUCIBILITY

---

## 1. Executive Summary

A rigorous audit of repository dependency management and build reproducibility was conducted:
- **Current Snapshot Discrepancy Identified:** In the current repository snapshot, `package-lock.json` is **absent** from the file tree (a `bun.lock` artifact exists from repository import). Consequently, running `npm ci` fails with `npm error code EUSAGE (ENOLOCK)`:
  ```
  npm error The `npm ci` command can only install with an existing package-lock.json or npm-shrinkwrap.json
  ```
- **Action Required for CI/CD:** To make GitHub Actions CI/CD (`.github/workflows/deploy.yml`) work deterministically, `package-lock.json` must be generated using `npm i --package-lock-only` and committed to the repository.
- **Active Tooling & Build Health:**
  - TypeScript static analysis (`npm run lint` / `tsc --noEmit`): **0 errors**.
  - Production asset compilation (`npm run build` / `vite build`): **Build succeeded** (1725 modules transformed cleanly).
- **Vulnerability Defense Policy:** In `package.json`, an explicit override (`"overrides": { "sharp": "^0.35.5" }`) is defined to prevent transitive vulnerabilities in `sharp` without breaking modern Cloudflare tooling.

---

## 2. Dependency Tree Status

### Environment
- **Node.js:** `v22.23.2`
- **npm:** `10.9.8`
- **Lockfile Format:** None present in repository snapshot (`package-lock.json` missing; `bun.lock` present)

### Production Runtime Dependencies (`dependencies` in `package.json`)
| Package | Declared Version | Purpose / Scope | Status |
| :--- | :--- | :--- | :--- |
| `@tailwindcss/vite` | `^4.1.14` | Tailwind CSS v4 Vite integration plugin | Verified from source & build |
| `@vitejs/plugin-react` | `^6.1.2` | Vite React fast refresh & JSX plugin | Verified from source & build |
| `lucide-react` | `^0.546.0` | Production icon library | Verified from source & build |
| `react` | `^19.0.1` | React 19 UI library | Verified from source & build |
| `react-dom` | `^19.0.1` | React 19 DOM renderer | Verified from source & build |

### Development Dependencies (`devDependencies` in `package.json`)
| Package | Declared Version | Purpose / Scope | Status |
| :--- | :--- | :--- | :--- |
| `@types/node` | `^22.14.0` | TypeScript type declarations for Node.js | Verified from source & lint |
| `sharp` | `^0.35.5` | Top-level image optimization utility | Overridden in package.json |
| `tailwindcss` | `^4.1.14` | Tailwind CSS v4 stylesheet engine | Verified from source & build |
| `tsx` | `^4.21.0` | TypeScript test execution runner | Verified by test executions |
| `typescript` | `~5.8.2` | Static type checker (`tsc --noEmit`) | Verified by lint check |
| `vite` | `^8.3.2` | Development dev-server and asset bundler | Verified by dev & build |
| `wrangler` | `^4.137.0` | Cloudflare Workers & D1 CLI tool | Verified from source |

---

## 3. Package-Lock Status & CI Verification

- **Current Repository State:** `package-lock.json` is missing from the project snapshot.
- **Direct Test Result (`npm ci`):**
  ```bash
  $ npm ci
  npm error code EUSAGE
  npm error The `npm ci` command can only install with an existing package-lock.json or npm-shrinkwrap.json
  ```
- **Impact on CI/CD:** `.github/workflows/deploy.yml` runs `npm ci` in both `validate` and `deploy` jobs. This will fail until `package-lock.json` is committed.
- **Remediation Command:**
  ```bash
  npm i --package-lock-only
  git add package-lock.json
  git commit -m "chore: commit package-lock.json for npm ci reproducibility"
  ```

---

## 4. Build & Quality Verification

1. **TypeScript Static Analysis:** `npm run lint` (`tsc --noEmit`) &rarr; **0 errors**.
2. **Vite Production Asset Build:** `npm run build` &rarr; 1725 modules transformed, clean `dist/` bundle created with zero errors.
3. **Automated Test Suites Executed:**
   - `npx tsx scripts/verify-webhook-replay-protection.ts` &rarr; **18 PASSED, 0 FAILED**.
   - `npx tsx scripts/verify-courier-webhook-atomicity.ts` &rarr; **19 PASSED, 0 FAILED**.

---

## 5. Summary of Current State & Next Steps

* **`package-lock.json` present:** **No** (absent from current snapshot; `bun.lock` exists).
* **Deterministic builds (`npm ci`):** **Requires lockfile generation** before `npm ci` succeeds.
* **TypeScript Compilation:** **PASS** (0 errors).
* **Vite Production Build:** **PASS** (compilation succeeded).
* **Transitive `sharp` override:** Configured in `package.json` (`"overrides": { "sharp": "^0.35.5" }`).
