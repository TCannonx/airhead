import { expect, test, type Page } from '@playwright/test';
import { lit, sql, userIdFor } from './db.ts';
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

test('a longer dated note: its event shows at once, then sorting tidies it and adds the lost task', async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ai-tidy-${Date.now()}@example.test`);
  const note = 'Training on Tuesday. Need a reminder to send report to Trevor';
  await capture(a, note);
  // The instant event is there straight away, and the note still waits for sorting.
  const recent = a.getByRole('list', { name: 'Recent captures' });
  await expect(recent.getByText(/^(?:Event added|Suggestion): /)).toBeVisible();

  await sortNow(a);
  const done = a.getByRole('list', { name: 'Done by AI' });
  await expect(done.getByText('Tidied “Training” and added 1 item')).toBeVisible({
    timeout: 60_000,
  });

  // One event, now called "Training", and the task the note asked for.
  await a.getByRole('link', { name: 'Library' }).first().click();
  const items = a.getByRole('list', { name: 'Items' });
  await expect(items.getByText('Training', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(items.getByText('Send report to Trevor', { exact: true })).toBeVisible();
  await expect(items.getByText(/^Training \. Need/)).toHaveCount(0);
});

test('"Quiz every Thursday 8pm-12pm" keeps its end time', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ai-quiz-${Date.now()}@example.test`);
  await capture(a, 'Quiz every Thursday 8pm-12pm');
  const recent = a.getByRole('list', { name: 'Recent captures' });
  await expect(recent.getByText(/^Event added: Thu/)).toBeVisible();

  await a.getByRole('link', { name: 'Library' }).first().click();
  await a.getByRole('list', { name: 'Items' }).getByText('Quiz', { exact: true }).click();
  await expect(a.getByText(/20:00\s*[–-]\s*00:00/)).toBeVisible({ timeout: 30_000 });
});

test('a typed note is read by AI: the task it asks for appears, the note is unchanged', async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ai-notes-${Date.now()}@example.test`);
  await a.getByRole('link', { name: 'Library' }).first().click();
  await a.getByRole('button', { name: 'New note' }).click();
  await expect(a).toHaveURL(/\/notes\//);
  const noteUrl = a.url();
  const text = 'need to send the report to Trevor by Friday';
  const editor = a.getByLabel('Note', { exact: true });
  await editor.click();
  await a.keyboard.type(text);
  // Saved after a short pause; Sort now syncs it first.
  await a.waitForTimeout(1500);

  // Only a note is waiting (no capture): Sort now still looks at it.
  await sortNow(a);
  await expect(a.getByText(/^Looked at 1 note/)).toBeVisible({ timeout: 60_000 });

  await a.getByRole('link', { name: 'Library' }).first().click();
  const items = a.getByRole('list', { name: 'Items' });
  await expect(items.getByText('Send the report to Trevor', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // The note itself is exactly as written.
  await a.goto(noteUrl);
  await expect(a.getByLabel('Note', { exact: true })).toHaveText(text, { timeout: 30_000 });
});

// Workshop routing (Task 11.2): nothing a note says is lost.
test('Send to Workshop on a fresh capture: it is in "To flesh out" here and on the other device', async ({
  browser,
}) => {
  const email = `e2e-ws-send-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  await capture(a, 'plan the attic conversion');
  const recent = a.getByRole('list', { name: 'Recent captures' });
  const row = recent.getByRole('listitem').filter({ hasText: 'plan the attic conversion' });
  await row.getByRole('button', { name: 'Send to Workshop' }).click();
  await expect(row.getByText('Sent to Workshop')).toBeVisible();

  await a.getByRole('link', { name: 'Inbox' }).first().click();
  const flesh = a.getByRole('list', { name: 'To flesh out' });
  await expect(flesh.getByRole('link', { name: 'Plan the attic conversion' })).toBeVisible();

  // The other device receives the Workshop note once the first has pushed it.
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);
  await b.getByRole('link', { name: 'Inbox' }).first().click();
  const fleshB = b
    .getByRole('list', { name: 'To flesh out' })
    .getByRole('link', { name: 'Plan the attic conversion' });
  await expect(async () => {
    await b.reload();
    await expect(fleshB).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
});

test('Sort now on a placeholder note: the event, a planning task with steps, and questions (Task 12.1)', async ({
  browser,
}) => {
  const email = `e2e-trust-plan-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  await capture(
    a,
    'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder',
  );
  await sortNow(a);
  await expect(a.getByText(/^Sorted 1 capture.*3 questions/)).toBeVisible({ timeout: 60_000 });

  await a.getByRole('link', { name: 'Library' }).first().click();
  const items = a.getByRole('list', { name: 'Items' });
  await expect(items.getByText('Christmas sandwiches', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(items.getByText('Plan Christmas sandwiches', { exact: true })).toBeVisible();

  // The server holds the planning task (due before the first Friday, with its
  // checklist) and three open questions about the event, from the same batch.
  const user = userIdFor(email);
  const due = sql(
    `select (t.due_at < e.start_at)::text || ' ' || (t.body like '- [ ] %')::text
       from public.items t join public.items e on e.capture_id = t.capture_id and e.type = 'event'
      where t.user_id = ${lit(user)} and t.title = 'Plan Christmas sandwiches'`,
  );
  expect(due).toBe('true true');
  const asked = sql(
    `select string_agg(f.question, ' | ' order by f.question)
       from public.follow_ups f join public.items i on i.id = f.item_id
      where f.user_id = ${lit(user)} and f.status = 'open' and i.title = 'Christmas sandwiches'`,
  );
  expect(asked).toBe('How many people? | Making them or ordering? | Who are the sandwiches for?');
});

test('words sorting cannot place are kept in the Workshop, next to what it could place', async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ws-leftover-${Date.now()}@example.test`);
  await capture(a, 'Call the plumber. Maybe something about the shed');
  await sortNow(a);
  const flesh = a.getByRole('list', { name: 'To flesh out' });
  await expect(flesh.getByRole('link', { name: 'Maybe something about the shed' })).toBeVisible({
    timeout: 60_000,
  });

  await a.getByRole('link', { name: 'Library' }).first().click();
  const items = a.getByRole('list', { name: 'Items' });
  await expect(items.getByText('Call the plumber', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await a.getByRole('link', { name: 'Capture' }).first().click();
  await expect(
    a.getByRole('list', { name: 'Recent captures' }).getByText(/· Sent to Workshop$/),
  ).toBeVisible({ timeout: 30_000 });
});

test('a note sorting cannot place goes to the Workshop instead of being lost', async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, `e2e-ws-vague-${Date.now()}@example.test`);
  await capture(a, 'hmm the thing with the stuff');
  await sortNow(a);
  await expect(a.getByText(/^Sorted 1 capture/)).toBeVisible({ timeout: 60_000 });
  const flesh = a.getByRole('list', { name: 'To flesh out' });
  await expect(flesh.getByRole('link', { name: 'Hmm the thing with the stuff' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(a.getByText('Nothing waiting. Everything is sorted.')).toBeVisible();

  await a.getByRole('link', { name: 'Capture' }).first().click();
  const recent = a.getByRole('list', { name: 'Recent captures' });
  await expect(recent.getByText('Sent to Workshop', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test('a question asked on A is answered on B; the new task and details reach A; Dismiss is a correction (Task 12.2)', async ({
  browser,
}) => {
  const email = `e2e-trust-answer-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);

  await capture(
    a,
    'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder',
  );
  await sortNow(a);
  const askedA = a.getByRole('list', { name: 'Questions for you' });
  await expect(askedA.getByText('Who are the sandwiches for?', { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  // B gets the questions too, and answers one with a quick answer.
  await b.getByRole('link', { name: 'Inbox' }).first().click();
  const askedB = b.getByRole('list', { name: 'Questions for you' });
  await expect(askedB.getByText('Who are the sandwiches for?', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await askedB.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(b.getByText('Thanks. Airhead will use that the next time it sorts.')).toBeVisible();
  await b.getByRole('button', { name: 'Sort now' }).click();
  await expect(b.getByText(/^Sorted 1 capture/)).toBeVisible({ timeout: 60_000 });

  // A: the answer is in the event's details, and the next step is a new task.
  await expect(askedA.getByText('Who are the sandwiches for?', { exact: true })).toHaveCount(0, {
    timeout: 60_000,
  });
  await a.getByRole('link', { name: 'Library' }).first().click();
  const items = a.getByRole('list', { name: 'Items' });
  await expect(items.getByText('Sandwiches for Work', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await items.getByText('Christmas sandwiches', { exact: true }).click();
  await expect(a.getByLabel('Notes')).toHaveValue(/Who are the sandwiches for\? Work/, {
    timeout: 30_000,
  });

  // Dismissing another question on A counts as a correction on the server.
  await a.getByRole('button', { name: 'Dismiss: How many people?' }).click();
  await expect(a.getByText('Dismissed. Airhead will ask less like that.')).toBeVisible();
  const user = userIdFor(email);
  await expect
    .poll(
      () =>
        sql(
          `select count(*) from public.corrections
            where user_id = ${lit(user)} and to_value ->> 'follow_up' = 'dismissed'`,
        ),
      { timeout: 60_000 },
    )
    .toBe('1');
  expect(
    sql(
      `select status || ' ' || coalesce(answer, '') from public.follow_ups
        where user_id = ${lit(user)} and question = 'Who are the sandwiches for?'`,
    ),
  ).toBe('answered Work');
});

test('What Airhead did: waiting before sorting, then every outcome with its words, on both devices (Task 12.3)', async ({
  browser,
}) => {
  const email = `e2e-trust-receipt-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);

  const text =
    'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder';
  await capture(a, text);
  const rowA = a
    .getByRole('list', { name: 'Recent captures' })
    .getByRole('listitem')
    .filter({ hasText: text });
  await rowA.getByText('What Airhead did', { exact: true }).click();
  await expect(
    rowA.getByText(/^Waiting for AI sorting \(next check by \d\d:\d\d\)$/),
  ).toBeVisible();

  await sortNow(a);
  await expect(a.getByText(/^Sorted 1 capture/)).toBeVisible({ timeout: 60_000 });

  for (const page of [a, b]) {
    await page.getByRole('link', { name: 'Capture' }).first().click();
    const row = page
      .getByRole('list', { name: 'Recent captures' })
      .getByRole('listitem')
      .filter({ hasText: text });
    const lines = row.getByRole('list', { name: 'What Airhead did' });
    await expect(async () => {
      if (!(await lines.isVisible()))
        await row.getByText('What Airhead did', { exact: true }).click();
      await expect(
        lines.getByRole('link', { name: 'Made a task with 3 steps: Plan Christmas sandwiches' }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(
      lines.getByRole('link', { name: 'Made an event: Christmas sandwiches' }),
    ).toBeVisible();
    await expect(lines.getByText('from “Still need to plan”', { exact: true })).toBeVisible();
    await expect(
      lines.getByText('Asked: Who are the sandwiches for?', { exact: true }),
    ).toBeVisible();
  }
});
