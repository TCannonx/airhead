import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers.ts';

// AI sorting end to end: the app, the real sort-batch Edge Function and the
// database, with tests/mock-ai standing in for the Anthropic API (it rejects
// requests the real API would reject). Then the result reaches a second device.

async function capture(page: Page, text: string) {
  await page.getByRole('link', { name: 'Capture' }).first().click();
  const box = page.getByLabel('Capture', { exact: true });
  await box.fill(text);
  await box.press('Enter');
  await expect(page.getByRole('list', { name: 'Recent captures' }).getByText(text)).toBeVisible();
}

async function sortNow(page: Page) {
  await page.getByRole('link', { name: 'Inbox' }).first().click();
  await page.getByRole('button', { name: 'Sort now' }).click();
}

test.describe.configure({ timeout: 150_000 });

test('Sort now sorts a capture with AI; a plain note becomes an item', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ai-note-${Date.now()}@example.test`);
  await capture(a, 'buy milk');
  await sortNow(a);
  await expect(a.getByText(/^Sorted 1 capture/)).toBeVisible({ timeout: 60_000 });
  await expect(a.getByText('Nothing waiting. Everything is sorted.')).toBeVisible({
    timeout: 30_000,
  });
});

test('a leave note becomes an action: booked, seen on the other device, undone', async ({
  browser,
}) => {
  const email = `e2e-ai-leave-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);

  // Without an entitlement set, the balance waits for an OK and says why.
  await capture(a, 'I have 9.5 days annual leave left');
  await sortNow(a);
  const asks = a.getByRole('list', { name: 'Needs your OK' });
  await expect(asks.getByText('Leave left set to 9.5 days')).toBeVisible({ timeout: 60_000 });
  await expect(asks.getByText('Set your yearly entitlement first (Settings → Work)')).toBeVisible();
  await expect(asks.getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/work');

  // A clear booking is applied straight away, with Undo.
  await capture(a, 'off 22-24 Dec');
  await sortNow(a);
  const done = a.getByRole('list', { name: 'Done by AI' });
  await expect(done.getByText(/^Annual leave booked: 22–24 Dec/)).toBeVisible({
    timeout: 60_000,
  });

  // The other device receives the booking.
  await b.goto('/work');
  const bookingsB = b.getByRole('list', { name: /leave year/ });
  await expect(bookingsB.getByText(/22 Dec – 24 Dec/)).toBeVisible({ timeout: 60_000 });

  // Undo removes it, and the other device follows.
  await done.getByRole('button', { name: /^Undo: Annual leave booked/ }).click();
  await expect(done).toHaveCount(0, { timeout: 30_000 });
  await b.reload();
  await expect(b.getByText(/22 Dec – 24 Dec/)).toHaveCount(0, { timeout: 60_000 });
});

test('"dentist moved to thursday 4pm" moves the existing event', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ai-move-${Date.now()}@example.test`);
  // The free rules make this a confident event straight away.
  await capture(a, 'dentist friday 3pm');
  await capture(a, 'dentist moved to thursday 4pm');
  await sortNow(a);
  const done = a.getByRole('list', { name: 'Done by AI' });
  await expect(done.getByText(/^Moved “Dentist” to Thu /)).toBeVisible({ timeout: 60_000 });
});

test('"remind me every 2 weeks to …" becomes a repeating task with a first reminder', async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ai-repeat-${Date.now()}@example.test`);
  await capture(a, 'remind me every 2 weeks to text the barber');
  await sortNow(a);
  await expect(a.getByText(/^Sorted 1 capture/)).toBeVisible({ timeout: 60_000 });

  await a.getByRole('link', { name: 'Library' }).first().click();
  await a.getByRole('link', { name: 'Text the barber' }).first().click();
  const line = a.getByText(/^Due: .* · repeats every 2 weeks$/);
  await expect(line).toBeVisible({ timeout: 30_000 });
});

test('the haircut note: a repeating reminder, and a cash reminder before every barber booking', async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ai-prep-${Date.now()}@example.test`);
  await capture(
    a,
    'I get a haircut every 2-3 weeks. Requires €20 cash. Remind me every 2-3 weeks to text barber for haircut and once booked, ensure I have cash for appointment',
  );
  await sortNow(a);
  const done = a.getByRole('list', { name: 'Done by AI' });
  await expect(
    done.getByText('Prep reminder: “Bring €20 cash” before “barber” or “haircut” events'),
  ).toBeVisible({ timeout: 60_000 });

  // The rule is listed in Settings.
  await a.getByRole('link', { name: 'Settings' }).first().click();
  const rules = a.getByRole('list', { name: 'Prep reminders' });
  await expect(rules.getByText('Bring €20 cash')).toBeVisible({ timeout: 30_000 });

  // A barber booking made later shows the cash reminder.
  await capture(a, 'barber friday 5pm');
  await a.getByRole('link', { name: 'Library' }).first().click();
  await a
    .getByRole('link', { name: /^Barber/ })
    .first()
    .click();
  await expect(a.getByText('Before this: Bring €20 cash (12 h before)')).toBeVisible({
    timeout: 30_000,
  });

  // And the repeating reminder to text the barber has a first due time.
  await a.getByRole('link', { name: 'Library' }).first().click();
  await a.getByRole('link', { name: 'Text barber for haircut' }).first().click();
  await expect(a.getByText(/^Due: .* · repeats every 2 weeks$/)).toBeVisible({ timeout: 30_000 });
});
