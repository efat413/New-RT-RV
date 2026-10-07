# Rongdhonu Trade (রঙধনু ট্রেড)

Production-ready Bangladeshi e-commerce storefront and admin management portal with dynamic rainbow branding, BDT currency, local payment gateways, and courier integration.

**Applet ID:** `fd57486e-ac43-439f-af46-a727d79a1195`  
**Repository:** `efat413/New-RT-RV`  
**Target Architecture:** Cloudflare Workers + Cloudflare D1 + React 19 (Vite 8 SPA)  

---

## Getting Started Locally

### Prerequisites
- **Node.js:** `>= 22.0.0`
- **npm:** `>= 10.0.0`

### Quick Start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure local environment variables:
   Copy `.env.example` to `.env` or `.dev.vars.example` to `.dev.vars` if running with Wrangler:
   ```bash
   cp .env.example .env
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
   The dev server binds to `0.0.0.0:3000` with full in-memory API simulation.

4. Run code quality checks:
   ```bash
   npm run lint       # Type check with tsc --noEmit
   npm run build      # Build production bundle with vite build
   ```

---

## Cloudflare Deployment

See [CLOUDFLARE_DEPLOYMENT_GUIDE.md](./CLOUDFLARE_DEPLOYMENT_GUIDE.md) and [CLOUDFLARE_PRODUCTION_VERIFICATION_CHECKLIST.md](./CLOUDFLARE_PRODUCTION_VERIFICATION_CHECKLIST.md) for full deployment instructions, D1 remote migration steps (`npm run d1:migrate`), and secrets configuration.
