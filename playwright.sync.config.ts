import { defineConfig, devices } from '@playwright/test';

// End-to-end sync tests against a real local Supabase stack (`supabase start`).
// Runs in CI's "e2e sync tests" job; needs VITE_SUPABASE_URL/ANON_KEY for the
// local stack in the environment when the app is built.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e-sync',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(isCI ? {} : { channel: 'chrome' }) },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
