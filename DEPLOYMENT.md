# C-Shopper — Deployment Guide

Fixed and verified 2026-09-25. Production build passes (`npm run build`, `tsc --noEmit` clean)
and all 10 UI smoke checks pass in headless Chromium (dashboard, catalog, watchlist,
community, food court, upload, pricing, corrupted-storage recovery, styled render).

## What's in this zip

- Full source (`App.tsx`, `index.tsx`, `index.css`, `services/gemini.ts`, `types.ts`, configs)
- `.env.local` with a **placeholder** Gemini key — replace before building for real use
- `dist/` — a ready-to-serve production build (drag-and-drop deployable)

## Quick deploy options (static hosting)

The app is 100% static after `npm run build`. Any of these work:

1. **Vercel** — `vercel` CLI or import the folder; framework preset: Vite.
   Set env var `GEMINI_API_KEY` in the project settings before deploying.
2. **Netlify** — drag the `dist/` folder onto https://app.netlify.com/drop,
   or connect the repo with build command `npm run build`, publish dir `dist`.
   Set `GEMINI_API_KEY` under Site settings → Environment variables.
3. **Cloudflare Pages** — same build settings as Netlify; set `GEMINI_API_KEY` in
   the Pages project environment variables.

## Important: Gemini API key

Receipt scanning calls the Gemini API from the browser. The key is baked into the
bundle at **build time** from the `GEMINI_API_KEY` env var (see `vite.config.ts`).
Without a real key, scanning shows a clear error and everything else still works.
Get a key at https://aistudio.google.com/apikey and rebuild/redeploy after setting it.
Never commit `.env.local` (it's git-ignored).

## Known limitations (by design, for now)

- **No backend** — receipts, watchlist, groups, and reviews live in the browser's
  `localStorage`. Each device/browser has its own data; community features use mock
  seed data. A shared backend (e.g. Firebase/Supabase) is the natural next step
  before real multi-user launch.
- **Stores/prices are mock data** (3 Seattle-area warehouses) — wire to a real
  data source before launch.

## Local development

```bash
npm install
# put your real key in .env.local as GEMINI_API_KEY=...
npm run dev      # dev server on http://localhost:3000
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```
