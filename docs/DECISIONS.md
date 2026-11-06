# Decisions

Decisions and library versions, newest first.

## 2026-11-06 — Task 1.3 Responsive layout
- **React Router 8.5.1 in data mode**: `createBrowserRouter` from `react-router`, `RouterProvider` from `react-router/dom` (per the package's own `docs/start/data/installation.md`). Routes live in `src/app/routes.tsx` so tests can use `createMemoryRouter` with the same table.
- **Layout is chosen in JavaScript, not only CSS**: `layoutFor(width)` (phone < 768, tablet 768–1279, desktop ≥ 1280) with a `useSyncExternalStore` resize hook. Only one navigation is in the DOM at a time, so screen readers and tests see exactly one.
- `/` redirects to `/capture` (Capture is the home screen); unknown paths do too.
- On the phone, Settings is a gear button in the top bar (five tabs fit; no hidden commands). On iPad and desktop it sits at the foot of the sidebar.
- The desktop right panel is a placeholder ("Today at a glance") until Phase 5 fills it.
- Light/dark follows the system (`prefers-color-scheme`, Tailwind's default `dark:` variant). Safe areas use `env(safe-area-inset-*)` with `viewport-fit=cover`.
- Icons are hand-drawn inline SVGs in `src/app/Icon.tsx`; no icon library yet.

## 2026-11-06 — Task 1.2 PWA shell
- **Verify (iOS home-screen requirements):** iOS still takes the home-screen icon from `<link rel="apple-touch-icon">` (180×180 PNG, not the manifest), turns transparent pixels black, and supports only `display: standalone`. It also honours `apple-mobile-web-app-capable`, `-title` and `-status-bar-style` meta tags. If the manifest loads late, "Add to Home Screen" makes a plain bookmark, so the manifest link is in the static HTML. Sources: web.dev "PWA enhancements"; vite-pwa injectManifest guide. Splash screens (`apple-touch-startup-image`) are skipped for now.
- **vite-plugin-pwa 2.0.0, `injectManifest`** with `srcDir: 'src/sw'`, `filename: 'sw.ts'`; Workbox 7.4 modules (`workbox-precaching`, `-routing`, `-core`). The SW precaches the built shell, serves `index.html` for every navigation (deep links work offline), and calls `skipWaiting` + `clientsClaim` (data lives in IndexedDB, so swapping the shell is safe). `registerType: 'autoUpdate'`, registered in `src/main.tsx` via `virtual:pwa-register`; dev-mode SW off.
- The service worker has its own `tsconfig.sw.json` (WebWorker lib); `src/sw` is excluded from the app tsconfig.
- **Placeholder icons** are generated from `public/logo.svg` with `@vite-pwa/assets-generator` 2.0.0 (`minimal-2023` preset, solid background for the Apple and maskable icons). Regenerate with `npx pwa-assets-generator`.
- Theme colour `#4f46e5` (indigo) light, `#020617` dark; `background_color` white.

## 2026-11-06 — Task 1.1 scaffold
- **TypeScript held at 6.0.x (`~6.0.3`), not 7.0.** The current Vite template ships TypeScript 7.0.2, but `typescript-eslint` 8.72.1 (current) supports only `>=4.8.4 <6.1.0`, and the plan requires ESLint. Revisit when typescript-eslint supports TS 7.
- **ESLint, not oxlint.** The current `create-vite` template uses oxlint; the plan specifies ESLint, so ESLint 10 flat config is used with `typescript-eslint` strict, `eslint-plugin-react-hooks` (flat recommended), `eslint-plugin-react-refresh` (vite preset) and `eslint-config-prettier`. `npm run lint` runs ESLint then `prettier --check`.
- **Strict TypeScript**: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, plus the template's unused/erasable-syntax checks.
- **Tailwind CSS 4** through the `@tailwindcss/vite` plugin (`@import 'tailwindcss'` in `src/index.css`); no `tailwind.config` file needed in v4.
- **Vitest** has its own `vitest.config.ts` merged over `vite.config.ts`, jsdom environment, `@testing-library/jest-dom/vitest` in `src/test/setup.ts`.
- **Playwright locally uses the installed Google Chrome** (`channel: 'chrome'`) so no browser binaries are downloaded onto the machine; CI installs Playwright's Chromium. E2E runs against `vite preview` on port 4173.
- **Line endings**: `.gitattributes` forces LF and `core.autocrlf=false` is set in this clone, so Prettier and Git agree on Windows.
- **GitHub repo** `TCannonx/airhead` (private) created through the REST API (`POST /user/repos`) with squash-only merges, auto-merge allowed and delete-branch-on-merge, which matches the `gh repo edit` flags in `CLAUDE.md`. A local hook blocks pushing to `main`, so the repo was created with GitHub's initial commit and the docs landed through PR #1.

| Package | Version |
| --- | --- |
| react, react-dom | 19.3.1 |
| vite | 8.3.6 |
| @vitejs/plugin-react | 6.2.1 |
| typescript | 6.0.3 |
| tailwindcss, @tailwindcss/vite | 4.3.5 |
| eslint | 10.14.0 |
| @eslint/js | 10.0.1 |
| typescript-eslint | 8.72.1 |
| eslint-plugin-react-hooks | 7.1.1 |
| eslint-plugin-react-refresh | 0.5.7 |
| eslint-config-prettier | 10.1.8 |
| prettier | 3.9.10 |
| vitest | 5.1.0 |
| jsdom | 31.0.0 |
| @testing-library/react | 16.3.3 |
| @testing-library/jest-dom | 7.0.1 |
| @testing-library/user-event | 14.6.8 |
| @playwright/test | 1.65.0 |
| Node.js (local) | 24.19.0 |

## 2026-11-06 — Tooling on this machine
- **GitHub CLI (`gh`) is not installed.** Repo creation, settings, PRs, check polling and merges use the GitHub REST API directly, with the token held by Git Credential Manager (`git credential fill`). Each `gh` command in `CLAUDE.md` maps to its REST equivalent (`POST /user/repos`, `PATCH /repos/{o}/{r}`, `POST /pulls`, `PUT /pulls/{n}/merge`, etc.). Auto-merge is done by polling check runs and merging only when all are green, which is equivalent to `gh pr merge --squash --auto`.
- **Supabase CLI, Deno and Docker are not installed.** The Supabase CLI runs through `npx supabase`. Tests that need the local Supabase stack (RLS, SQL, Deno function tests) run in GitHub Actions, where Docker is available; CI is the gate for them.
- **npm runs from Git Bash**, because PowerShell's execution policy blocks `npm.ps1`.
- Git identity is repo-local: Thomas Cannon, GitHub noreply address (same as StatPadder).

## 2026-11-06 — Project location
- Project lives in personal OneDrive: `C:\Users\Thomas_Cannon\OneDrive\GitHub\airhead` (user requirement: nothing stored on the local machine outside OneDrive).
- `CLAUDE.md` at repo root; supplied `settings.json` placed at `.claude/settings.json` (project-level Claude Code settings).
