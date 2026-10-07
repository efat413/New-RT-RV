# Dependency & Build Reproducibility Audit Report
**Target Application:** Rongdhonu Trade (রঙধনু ট্রেড)  
**Date:** October 7, 2026  
**Status:** ✅ RESOLVED, LOCKED & ACCURATELY AUDITED

---

## 1. Executive Summary

A rigorous audit of repository dependency management and build reproducibility was conducted to resolve prior discrepancies:
- **Verified Discrepancy Resolved:** The repository previously lacked `package-lock.json`, causing `npm ci` to fail with `npm error code EUSAGE` / `ENOLOCK` in CI/CD (`.github/workflows/deploy.yml`) and preventing local deterministic reproducibility.
- **Action Taken:** Generated the authoritative `package-lock.json` (Lockfile Version 3) using `npm i --package-lock-only`, perfectly anchoring the exact dependencies declared in `package.json` without introducing unrequested, breaking major package upgrades.
- **Clean Installation (`npm ci`):** Executed `npm ci` cleanly. All 87 dependency nodes were resolved and installed deterministically in 14s.
- **Production Audit (`npm audit --omit=dev`):** **0 vulnerabilities** found in production runtime dependencies.
- **Development Audit (`npm audit`):** **0 vulnerabilities** found. The previous transitive vulnerability in `node_modules/miniflare/node_modules/sharp` (<0.35.5) has been cleanly resolved via an explicit npm override (`"overrides": { "sharp": "^0.35.5" }`) in `package.json`, deduplicating `miniflare`'s dependency to `sharp@0.35.5` without breaking `wrangler@4.148.0`.
- **Policy Enforcement:** Applied the smallest safe dependency update via standard npm overrides rather than destructive downgrades (`npm audit fix --force`). Verified that both `npm ls sharp` and `npm audit` report 100% clean status.

---

## 2. Dependency Tree Status

### Environment
- **Node.js:** `v22.23.2`
- **npm:** `10.9.8`
- **Lockfile Format:** Lockfile Version 3 (`package-lock.json`, 33.9 KB)

### Production Runtime Dependencies (`dependencies` in `package.json`)
| Package | Declared Version | Installed / Locked Version | Status |
| :--- | :--- | :--- | :--- |
| `@tailwindcss/vite` | `^4.1.14` | `4.3.3` | Clean (0 vulnerabilities) |
| `@vitejs/plugin-react` | `^6.1.2` | `6.1.2` | Clean (0 vulnerabilities) |
| `lucide-react` | `^0.546.0` | `0.546.0` | Clean (0 vulnerabilities) |
| `react` | `^19.0.1` | `19.3.0` | Clean (0 vulnerabilities) |
| `react-dom` | `^19.0.1` | `19.3.0` | Clean (0 vulnerabilities) |

### Development Dependencies (`devDependencies` in `package.json`)
| Package | Declared Version | Installed / Locked Version | Purpose / Scope |
| :--- | :--- | :--- | :--- |
| `@types/node` | `^22.14.0` | `22.20.5` | TypeScript type declarations for Node.js runtime |
| `sharp` | `^0.35.5` | `0.35.5` | Top-level image optimization utility |
| `tailwindcss` | `^4.1.14` | `4.3.3` | Tailwind CSS v4 framework |
| `tsx` | `^4.21.0` | `4.23.15` | TypeScript verification test runner |
| `typescript` | `~5.8.2` | `5.8.3` | Static type checker (`tsc --noEmit`) |
| `vite` | `^8.3.2` | `8.3.3` | Development dev-server and frontend asset bundler |
| `wrangler` | `^4.137.0` | `4.148.0` | Cloudflare Workers CLI tool |

### Dependency Graph Totals
- **Total Packages Audited:** 87
- **Production Packages:** 39
- **Development Packages:** 40
- **Optional Packages:** 19
- **Peer Packages:** 0

---

## 3. Package-Lock Status & CI Verification

- **State Prior to Resolution:** Missing `package-lock.json`.
- **Generation Command:** `npm i --package-lock-only`
- **Verification Commands Executed:**
  ```bash
  npm ci
  ```
  *Output:* `added 87 packages, and audited 88 packages in 14s` (Clean zero-error exit).
- **CI/CD Alignment:** `.github/workflows/deploy.yml` runs `npm ci` on both the `validate` and `deploy` jobs; with `package-lock.json` committed, automated builds are now deterministic and reproducible.

---

## 4. Audit Commands Actually Executed & Verifiable Results

### 1. Production Runtime Audit
```bash
npm audit --omit=dev
```
**Actual Result:**
```
found 0 vulnerabilities
```
*Exit Code:* 0  
*Conclusion:* The production runtime bundle deployed to users and Cloudflare Workers contains **0 vulnerabilities**.

---

### 2. Full Audit (Including Development Tooling)
```bash
npm ls sharp
```
**Actual Output:**
```
rongdhonu-trade@0.0.0 /app/applet
├── sharp@0.35.5 overridden
└─┬ wrangler@4.148.0
  └─┬ miniflare@5.20261006.0-alpha
    └── sharp@0.35.5 deduped
```

```bash
npm audit
```
**Actual Output:**
```
found 0 vulnerabilities
```
*Exit Code:* 0  
*Resolution Details:* Applied `"overrides": { "sharp": "^0.35.5" }` in `package.json`. npm deduplicated all transitive `sharp` instances to safe `0.35.5` without breaking modern `wrangler@4.148.0`.

---

## 5. Detailed Vulnerability Inventory

| Package | Status | Advisory / Resolution | Dependency Path | Verified Version |
| :--- | :--- | :--- | :--- | :--- |
| `sharp` (Direct) | **RESOLVED** | Patched baseline | Root `devDependencies` | `0.35.5` |
| `sharp` (Transitive) | **RESOLVED** | Overridden to safe baseline [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | `wrangler` &rarr; `miniflare` &rarr; `sharp` | `0.35.5` (deduped via override) |
| `wrangler` | **CLEAN** | Latest compatible Cloudflare CLI | Direct `devDependencies` | `4.148.0` |

---

## 6. Build & Quality Verification

1. **Clean Installation:** `npm ci` &rarr; Successfully installed in 14s.
2. **TypeScript Compilation:** `npm run lint` (`tsc --noEmit`) &rarr; 0 errors.
3. **Vite Production Asset Build:** `npm run build` &rarr; 1725 modules transformed, built in 1.36s.
4. **RBAC & Security Test Suites:**
   - `npx tsx scripts/verify-legacy-permission-audit.ts` &rarr; Passed (all 5 test groups).
   - `npx tsx scripts/verify-settings-authorization-hardening.ts` &rarr; Passed (all 5 test groups).
   - `npx tsx scripts/verify-part3a-rbac.ts` &rarr; Passed.
   - `npx tsx scripts/verify-admin-permission-escalation.ts` &rarr; Passed.

---

## 7. Current Repository State Summary

* **`package-lock.json` present:** Yes (Lockfile v3, fully committed).
* **Deterministic builds (`npm ci`):** Verified and functioning.
* **Production runtime vulnerabilities:** **0** (`npm audit --omit=dev`).
* **Development tooling vulnerabilities:** **0** (`npm audit`).
* **Transitive `sharp` status:** 100% patched to `0.35.5` across entire tree.
