import { expect, test } from '@playwright/test';
import { dispatchSortingFor, lit, sql, userIdFor, waitForSql } from './db.ts';
import { capture, signIn } from './helpers.ts';

// Background sorting with no tap (TEST-MATRIX gaps 6 and 19): the scheduler's
// SQL (dispatch_sort_batches, what pg_cron runs every 5 minutes) → pg_net →
// the real sort-batch Edge Function with the service key from Vault → the
// database → the devices. CI puts the local stack's URL and service key in
// Vault and stops pg_cron's own schedules, so only these tests start a batch.

test.describe.configure({ timeout: 150_000 });

const statusOf = (user: string, text: string) =>
  `select status from public.captures where user_id = ${lit(user)} and text = ${lit(text)}`;

test('a capture is sorted in the background with no tap, and the item reaches the other device', async ({
  browser,
}) => {
  const email = `e2e-cron-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  // B opens before the capture exists, so its "sort on open" has nothing to do.
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);
  const user = userIdFor(email);

  const text = 'pick up the dry cleaning';
  await capture(a, text);
  await waitForSql(statusOf(user, text), 'unsorted', 30_000);

  expect(dispatchSortingFor(user)).toBeGreaterThanOrEqual(1);
  await waitForSql(statusOf(user, text), 'sorted');
  expect(
    sql(
      `select count(*) from public.ai_usage where user_id = ${lit(user)} and task = 'sort_batch' and ok`,
    ),
  ).toBe('1');

  // Nobody tapped Sort now: the item still arrives on both devices.
  for (const page of [b, a]) {
    await page.getByRole('link', { name: 'Library' }).first().click();
    const item = page
      .getByRole('list', { name: 'Items' })
      .getByText('Pick up the dry cleaning', { exact: true });
    await expect(async () => {
      await page.reload();
      await expect(item).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
  }
  await a.getByRole('link', { name: 'Inbox' }).first().click();
  await expect(a.getByText('Nothing waiting. Everything is sorted.')).toBeVisible({
    timeout: 30_000,
  });
});

test('at the monthly AI limit the batch is skipped, the capture stays Unsorted and the app says why', async ({
  browser,
}) => {
  const email = `e2e-cap-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  const user = userIdFor(email);

  // Spend this month already: one earlier AI call costing €1.
  sql(
    `insert into public.ai_usage (user_id, task, tier, model, ok, cost_eur)
       values (${lit(user)}, 'sort_batch', 'small', 'claude-haiku-4-5', true, 1)`,
  );

  // A tiny limit, set in the app (Insights → AI usage), reaches the server.
  await a.getByRole('link', { name: 'Insights' }).first().click();
  await a.getByLabel('Monthly limit (€)').fill('0.5');
  await a.getByRole('button', { name: 'Save limit' }).click();
  await expect(a.getByText('Monthly limit', { exact: true })).toBeVisible();
  await expect(a.getByText(/^At the limit, background sorting pauses/)).toBeVisible();
  await waitForSql(
    `select data ->> 'ai_monthly_cap_eur' from public.settings where user_id = ${lit(user)}`,
    '0.5',
    30_000,
  );

  const text = 'renew the car tax';
  await capture(a, text);
  await waitForSql(statusOf(user, text), 'unsorted', 30_000);

  // The background batch runs and stops at the limit: nothing is sent to the AI.
  expect(dispatchSortingFor(user)).toBeGreaterThanOrEqual(1);
  await waitForSql(
    `select count(*) from public.ai_usage where user_id = ${lit(user)} and error_code = 'cap_reached'`,
    '1',
  );
  expect(sql(statusOf(user, text))).toBe('unsorted');
  expect(
    sql(`select count(*) from public.items where user_id = ${lit(user)} and deleted_at is null`),
  ).toBe('0');

  // On the device it is still Unsorted, and Sort now explains the limit.
  await a.getByRole('link', { name: 'Inbox' }).first().click();
  const unsorted = a.getByRole('list', { name: 'Unsorted' });
  await expect(unsorted.getByText(text)).toBeVisible();
  await a.getByRole('button', { name: 'Sort now' }).click();
  await expect(
    a.getByText('This month’s AI limit has been reached. Raise it in Insights → AI usage.'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(unsorted.getByText(text)).toBeVisible();
  expect(sql(statusOf(user, text))).toBe('unsorted');
});
