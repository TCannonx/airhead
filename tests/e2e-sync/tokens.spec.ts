import { expect, test } from '@playwright/test';
import { lit, sql, userIdFor } from './db.ts';
import { signIn } from './helpers.ts';

// Capture from anywhere (TEST-MATRIX gap 16): a token made in Settings, a
// Shortcut-style POST to the real ingest-capture Edge Function, the capture on
// the device, then a revoked token refused by the function.

const FUNCTIONS = `${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/functions/v1`;

test('a capture token made in Settings saves a capture through ingest-capture; once revoked it gets 401', async ({
  browser,
  request,
}) => {
  const email = `e2e-token-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  const user = userIdFor(email);

  await a.getByRole('link', { name: 'Settings' }).first().click();
  await a.getByRole('button', { name: 'Create token' }).click();
  const shown = a.getByRole('alert').filter({ hasText: 'Copy this token now' });
  await expect(shown).toBeVisible({ timeout: 30_000 });
  const token = ((await shown.locator('code').textContent()) ?? '').trim();
  expect(token.length).toBeGreaterThan(20);
  await shown.getByRole('button', { name: 'Done' }).click();
  const tokens = a.getByRole('list', { name: 'Capture tokens' });
  await expect(tokens.getByText('Last used: never')).toBeVisible();
  // Only the hash is kept on the server.
  expect(
    sql(
      `select count(*) from public.capture_tokens where user_id = ${lit(user)} and token_hash = ${lit(token)}`,
    ),
  ).toBe('0');

  const text = 'shortcut capture: book the NCT';
  const saved = await request.post(`${FUNCTIONS}/ingest-capture`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { text },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  expect(
    sql(
      `select source || ' ' || status from public.captures where user_id = ${lit(user)} and text = ${lit(text)}`,
    ),
  ).toBe('shortcut unsorted');

  // The device receives it (Realtime, or the next pull).
  await a.getByRole('link', { name: 'Capture' }).first().click();
  const recent = a.getByRole('list', { name: 'Recent captures' }).getByText(text);
  await expect(async () => {
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(recent).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  // Revoke it in Settings: the function now refuses the same token.
  await a.getByRole('link', { name: 'Settings' }).first().click();
  await expect(tokens.getByText(/^Last used: (?!never)/)).toBeVisible({ timeout: 30_000 });
  await tokens.getByRole('button', { name: 'Revoke iPhone' }).click();
  await expect(tokens.getByText(/^Revoked /)).toBeVisible({ timeout: 30_000 });

  const refused = await request.post(`${FUNCTIONS}/ingest-capture`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { text: 'after revoking' },
  });
  expect(refused.status()).toBe(401);
  expect(await refused.text()).toContain('revoked');
  expect(
    sql(
      `select count(*) from public.captures where user_id = ${lit(user)} and text = 'after revoking'`,
    ),
  ).toBe('0');
});
