import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

test('a capture made offline on one browser appears on the other after reconnecting', async ({
  browser,
}) => {
  const email = `e2e-capture-${Date.now()}@example.test`;
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await signIn(a, email);
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);

  await ctxA.setOffline(true);
  const box = a.getByLabel('Capture', { exact: true });
  await box.fill('Dentist Tue 3pm (captured offline)');
  await box.press('Enter');
  const recentA = a.getByRole('list', { name: 'Recent captures' });
  await expect(recentA.getByText('Dentist Tue 3pm (captured offline)')).toBeVisible();

  // The status indicator shows the changes waiting on this device.
  await expect(a.getByText(/^Offline · \d+ waiting$/)).toBeVisible({ timeout: 15_000 });

  // Still offline: B must not have it yet.
  await b.waitForTimeout(3_000);
  await expect(b.getByText('Dentist Tue 3pm (captured offline)')).toHaveCount(0);

  await ctxA.setOffline(false);
  await a.evaluate(() => window.dispatchEvent(new Event('online')));

  // Within the plan's "within a minute of reconnecting" (Realtime makes it seconds).
  await expect(
    b
      .getByRole('list', { name: 'Recent captures' })
      .getByText('Dentist Tue 3pm (captured offline)'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(a.getByText('Synced', { exact: true })).toBeVisible({ timeout: 30_000 });
});
