import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

test('each browser registers its device locally, and sync shows it on the other', async ({
  browser,
}) => {
  const email = `e2e-${Date.now()}@example.test`;

  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  await a.getByRole('link', { name: 'Settings' }).click();
  const listA = a.getByRole('list', { name: 'Devices' });
  await expect(listA.getByRole('listitem')).toHaveCount(1);

  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);
  await b.getByRole('link', { name: 'Settings' }).click();

  // B pulls A's device on sign-in; A hears about B through Realtime without a
  // reload (well inside the 60 s polling interval).
  await expect(b.getByRole('list', { name: 'Devices' }).getByRole('listitem')).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(listA.getByRole('listitem')).toHaveCount(2, { timeout: 30_000 });
});
