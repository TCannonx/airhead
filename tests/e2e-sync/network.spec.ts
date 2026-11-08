import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

// Sync under a bad connection: a request that never answers must not freeze
// sync (2026-11-08: a phone stopped receiving changes). The stalled request
// times out, sync retries, and the other device gets the capture.

test.describe.configure({ timeout: 150_000 });

test('a stalled request does not stop sync; the capture still reaches the other device', async ({
  browser,
}) => {
  const email = `e2e-stall-${Date.now()}@example.test`;
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await signIn(a, email);
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);

  // The next push of captures hangs (never answered), once.
  let stalled = false;
  await ctxA.route('**/rest/v1/captures*', async (route) => {
    if (!stalled && route.request().method() === 'POST') {
      stalled = true;
      return; // never fulfilled: the request hangs until the app gives up on it
    }
    await route.continue();
  });

  const box = a.getByLabel('Capture', { exact: true });
  await box.fill('Captured during a stall');
  await box.press('Enter');

  await expect(
    b.getByRole('list', { name: 'Recent captures' }).getByText('Captured during a stall'),
  ).toBeVisible({ timeout: 120_000 });
  expect(stalled).toBe(true);
});

test('Sort now still answers when sync is stuck', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await signIn(a, `e2e-stuck-sort-${Date.now()}@example.test`);
  const box = a.getByLabel('Capture', { exact: true });
  await box.fill('ring the plumber');
  await box.press('Enter');
  await expect(a.getByText('Synced', { exact: true })).toBeVisible({ timeout: 30_000 });

  // From now on every data request hangs; only the sorting function answers.
  await ctx.route('**/rest/v1/**', () => {});
  await a.getByRole('link', { name: 'Inbox' }).first().click();
  await a.getByRole('button', { name: 'Sort now' }).click();
  await expect(a.getByText(/^Sorted 1 capture/)).toBeVisible({ timeout: 90_000 });
});

test('Sync now in Settings kicks a stuck sync straight away', async ({ browser }) => {
  const email = `e2e-kick-${Date.now()}@example.test`;
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await signIn(a, email);
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);

  // Every push of captures hangs until we let go.
  let release = false;
  await ctxA.route('**/rest/v1/captures*', async (route) => {
    if (!release && route.request().method() === 'POST') return; // never answered
    await route.continue();
  });
  const box = a.getByLabel('Capture', { exact: true });
  await box.fill('Kicked through by Sync now');
  await box.press('Enter');
  await a.waitForTimeout(4_000);

  // The connection is fine again; the user taps Sync now well before any time limit.
  release = true;
  await a.getByRole('link', { name: 'Settings' }).first().click();
  await a.getByRole('button', { name: 'Sync now' }).click();
  await expect(
    b.getByRole('list', { name: 'Recent captures' }).getByText('Kicked through by Sync now'),
  ).toBeVisible({ timeout: 15_000 });
});
