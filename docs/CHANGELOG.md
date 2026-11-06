# Changelog

One line per merged PR, newest first.

## Phase 1 — Foundations (ready for device testing, not yet released)

Installable, signed-in app shell for iPhone, iPad and desktop Chrome: offline shell, responsive layouts, Google / email-code sign-in, device list, optional Face ID / Touch ID lock, Supabase schema with RLS, CI with database and function tests, dev deploy, live release, keep-alive and backup workflows. Device checks: `docs/MANUAL-CHECKLIST.md` → Phase 1.

- Task 2.2: local Dexie database per user, outbox and sync state, shared Zod schemas, persistent storage request
- Task 2.1: captures, items, lists, topics, corrections tables with RLS, Realtime, nightly purge, private captures bucket
- Task 1.8: health function, function tests in CI, deploy-dev, release, keep-alive and weekly backup workflows
- Task 1.7: Cloudflare Pages hosting files (SPA mode, `_headers`, Node version) and setup steps
- Task 1.6: optional app lock with Face ID / Touch ID (WebAuthn), inactivity time-out, sign-out recovery
- Task 1.5: sign-in (Google login only, emailed 6-digit code fallback), device registration, Settings account and devices, local mode without a server
- Task 1.4: Supabase project files, migration 0001 (settings, devices, capture_tokens, RLS, sync trigger), pgTAP RLS tests, CI workflow
- Task 1.3: responsive layout (phone tabs, iPad sidebar, desktop three panes), routes for all six screens, light/dark, safe areas
- Task 1.2: installable PWA shell (manifest, iOS tags, placeholder icons, offline app-shell service worker)
- Task 1.1: scaffold (Vite + React + TypeScript strict, Tailwind, ESLint, Prettier, Vitest, Testing Library, Playwright)
