import { expect, test, type Page } from '@playwright/test';

// Calendar (Task 4.2) in local mode at desktop width: create from an empty
// slot, drag an event to another day, and drag a task onto the week to block time.

const LOCAL_USER = '00000000-0000-4000-8000-000000000001';

// Times below are Irish wall-clock times; CI machines run in UTC.
test.use({ timezoneId: 'Europe/Dublin' });

/** The centre of a week-view slot: the column for `date`, the row for `time`. */
async function slot(page: Page, date: string, time: string) {
  const rowLocator = page.locator(`[data-time="${time}"]`).first();
  await rowLocator.scrollIntoViewIfNeeded();
  // Wait until the grid has stopped moving (initial scroll and layout).
  await expect
    .poll(async () => {
      const a = await rowLocator.boundingBox();
      await page.waitForTimeout(150);
      const b = await rowLocator.boundingBox();
      return a && b && a.y === b.y && a.x === b.x;
    })
    .toBe(true);
  const col = await page.locator(`[role="columnheader"][data-date="${date}"]`).boundingBox();
  const row = await rowLocator.boundingBox();
  if (!col || !row) throw new Error(`no slot for ${date} ${time}`);
  return { x: col.x + col.width / 2, y: row.y + row.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, from.y + 5, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** Items in the local database (read straight from IndexedDB). */
function readItems(page: Page) {
  return page.evaluate(
    (user) =>
      new Promise<
        {
          id: string;
          title: string;
          type: string;
          start_at: string | null;
          rrule?: string | null;
          data?: Record<string, unknown>;
          deleted_at?: string | null;
        }[]
      >((resolve, reject) => {
        const req = indexedDB.open(`airhead-${user}`);
        req.onerror = () => reject(new Error('open failed'));
        req.onsuccess = () => {
          const all = req.result.transaction('items').objectStore('items').getAll();
          all.onsuccess = () => {
            resolve(all.result as never);
            req.result.close();
          };
        };
      }),
    LOCAL_USER,
  );
}

/** Puts events straight into the device database, then reloads so the app reads them. */
async function seedEvents(page: Page, rows: Record<string, unknown>[]) {
  // Write only once the app has made its database: opening it first would
  // create an empty one without the items table, and the write would never finish.
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async (name) => (await indexedDB.databases()).some((d) => d.name === name),
        `airhead-${LOCAL_USER}`,
      ),
    )
    .toBe(true);
  await page.evaluate(
    ([user, rows]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(`airhead-${user}`);
        req.onerror = () => reject(new Error('open failed'));
        req.onsuccess = () => {
          const t = new Date().toISOString();
          const tx = req.result.transaction('items', 'readwrite');
          tx.onerror = () => reject(new Error('write failed'));
          for (const r of rows)
            tx.objectStore('items').put({
              user_id: user,
              created_at: t,
              updated_at: t,
              server_updated_at: null,
              deleted_at: null,
              capture_id: null,
              type: 'event',
              body: null,
              data: {},
              status: 'open',
              due_at: null,
              end_at: null,
              all_day: false,
              rrule: null,
              calendar: 'personal',
              series_id: null,
              list_id: null,
              topic_ids: [],
              confidence: null,
              top3_date: null,
              carry_count: 0,
              completed_at: null,
              ...r,
            });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
      }),
    [LOCAL_USER, rows] as const,
  );
  await page.reload();
}

// Thursday 16 July 2026, 20:00–23:00 Dublin, every week; an all-day birthday on Friday 17th.
const QUIZ = {
  id: '22222222-2222-4222-8222-000000000001',
  title: 'Quiz',
  start_at: '2026-07-16T19:00:00.000Z',
  end_at: '2026-07-16T22:00:00.000Z',
  rrule: 'FREQ=WEEKLY',
  data: { location: 'The Local' },
};
const BIRTHDAY = {
  id: '22222222-2222-4222-8222-000000000002',
  title: 'Niamh’s Birthday',
  start_at: '2026-07-16T23:00:00.000Z',
  all_day: true,
  rrule: 'FREQ=YEARLY',
};

/** A quick horizontal swipe on the calendar (touch). */
async function swipe(page: Page, dx: number) {
  await page.getByTestId('calendar-body').evaluate((el, dx) => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + Math.min(200, box.height / 2);
    const touch = (cx: number) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    el.dispatchEvent(
      new TouchEvent('touchstart', {
        bubbles: true,
        touches: [touch(x)],
        changedTouches: [touch(x)],
      }),
    );
    el.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(x + dx)] }),
    );
  }, dx);
}

const period = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A fixed "now": Wednesday 15 July 2026, 08:00 in Dublin.
  await page.clock.setFixedTime(new Date('2026-07-15T07:00:00Z'));
});

test('create an event from an empty slot, then drag it to another day', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByRole('radio', { name: 'Week', checked: true })).toBeVisible();

  const start = await slot(page, '2026-07-15', '10:00:00');
  await page.mouse.click(start.x, start.y);
  const editor = page.getByRole('form', { name: 'New event' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Title').fill('Dentist');
  await editor.getByRole('button', { name: 'Save' }).click();

  // Inside the calendar (the desktop side panel lists today's events too).
  const event = page.locator('.ah-calendar').getByText('Dentist', { exact: true });
  await expect(event).toBeVisible();
  let dentist = (await readItems(page)).find((i) => i.title === 'Dentist');
  expect(dentist?.start_at).toBe('2026-07-15T09:00:00.000Z');

  const box = await event.boundingBox();
  if (!box) throw new Error('event not drawn');
  const target = await slot(page, '2026-07-17', '10:00:00');
  await drag(page, { x: box.x + box.width / 2, y: box.y + 4 }, { x: target.x, y: target.y });
  await expect
    .poll(async () => (await readItems(page)).find((i) => i.title === 'Dentist')?.start_at)
    .toBe('2026-07-17T09:00:00.000Z');
  dentist = (await readItems(page)).find((i) => i.title === 'Dentist');
  expect(dentist?.type).toBe('event');
});

test('drag a task onto the week to time-block it', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  // Seed an open task with no time, straight into the device database.
  await page.evaluate((user) => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.open(`airhead-${user}`);
      req.onsuccess = () => {
        const t = new Date().toISOString();
        const tx = req.result.transaction('items', 'readwrite');
        tx.objectStore('items').put({
          id: '11111111-1111-4111-8111-111111111111',
          user_id: user,
          created_at: t,
          updated_at: t,
          server_updated_at: null,
          deleted_at: null,
          capture_id: null,
          type: 'task',
          title: 'Write report',
          body: null,
          data: {},
          status: 'open',
          due_at: null,
          start_at: null,
          end_at: null,
          all_day: false,
          rrule: null,
          calendar: null,
          series_id: null,
          list_id: null,
          topic_ids: [],
          confidence: null,
          top3_date: null,
          carry_count: 0,
          completed_at: null,
        });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    });
  }, LOCAL_USER);
  await page.reload();

  const task = page.getByRole('list', { name: 'Tasks to plan' }).getByText('Write report');
  await expect(task).toBeVisible();
  const box = await task.boundingBox();
  if (!box) throw new Error('task not drawn');
  const target = await slot(page, '2026-07-16', '14:00:00');
  await drag(page, { x: box.x + 20, y: box.y + box.height / 2 }, target);

  await expect
    .poll(async () => (await readItems(page)).find((i) => i.title === 'Write report')?.start_at)
    .toBe('2026-07-16T13:00:00.000Z');
  await expect(page.getByRole('list', { name: 'Tasks to plan' })).not.toContainText('Write report');
});

test('select days in the month view and book them as leave', async ({ page }) => {
  await page.goto('/calendar');
  await page.getByRole('radio', { name: 'Month' }).click();
  const from = await page.locator('[data-date="2026-07-20"]').last().boundingBox();
  const to = await page.locator('[data-date="2026-07-22"]').last().boundingBox();
  if (!from || !to) throw new Error('month cells not drawn');
  await drag(
    page,
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    { x: to.x + to.width / 2, y: to.y + to.height / 2 },
  );
  const editor = page.getByRole('form', { name: 'New event' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Book as leave' }).click();

  const sheet = page.getByRole('form', { name: 'Book leave' });
  await expect(sheet.getByLabel('From')).toHaveValue('2026-07-20');
  await expect(sheet.getByLabel('To')).toHaveValue('2026-07-22');
  await expect(sheet.getByText(/Uses 3 days of leave/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Book leave' }).click();

  await expect(page.getByText('Annual leave · planned')).toBeVisible();
});

test.describe('easier viewing (Task 11.3)', () => {
  test('desktop: week opens at now with a red line; Today, previous, next and every view', async ({
    page,
  }) => {
    await page.goto('/calendar');
    await expect(page.getByRole('radio', { name: 'Week', checked: true })).toBeVisible();
    await expect(period(page, '13–19 Jul 2026')).toBeVisible();
    await expect(page.locator('.ah-now-line').first()).toBeInViewport();
    // Opened scrolled to the hour before now (08:00), not midnight.
    await expect(page.locator('[data-time="07:00:00"]').first()).toBeInViewport();
    await expect(page.locator('[data-time="01:00:00"]').first()).not.toBeInViewport();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(period(page, '20–26 Jul 2026')).toBeVisible();
    await page.getByRole('button', { name: 'Previous' }).click();
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(period(page, '6–12 Jul 2026')).toBeVisible();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(period(page, '13–19 Jul 2026')).toBeVisible();

    await page.getByRole('radio', { name: 'Month' }).click();
    await expect(period(page, 'July 2026')).toBeVisible();
    await page.getByRole('radio', { name: 'Day' }).click();
    await expect(period(page, 'Wed 15 Jul 2026')).toBeVisible();
    await expect(page.locator('.ah-now-line').first()).toBeVisible();
    await page.getByRole('radio', { name: 'Agenda' }).click();
    await expect(period(page, 'Next 30 days')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Agenda' })).toBeVisible();

    // Remembered on this device.
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Agenda', checked: true })).toBeVisible();
  });

  test('desktop: tapping an event shows its details first, Edit is one tap further', async ({
    page,
  }) => {
    await page.goto('/calendar');
    await seedEvents(page, [QUIZ, BIRTHDAY]);
    await page.locator('.ah-calendar').getByText('Quiz', { exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Quiz' });
    await expect(sheet).toContainText('Thu 16 Jul 2026, 20:00–23:00');
    await expect(sheet).toContainText('Every Thursday');
    await expect(sheet).toContainText('Personal');
    await expect(sheet).toContainText('The Local');
    await sheet.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('form', { name: 'Edit event' }).getByLabel('Title')).toHaveValue(
      'Quiz',
    );
    await page.keyboard.press('Escape');

    // The month grid has event chips; a birthday is all day.
    await page.getByRole('radio', { name: 'Month' }).click();
    await page.locator('.ah-calendar').getByText('Niamh’s Birthday').click();
    await expect(page.getByRole('dialog', { name: 'Niamh’s Birthday' })).toContainText(
      'Fri 17 Jul 2026 · All day',
    );
  });

  test.describe('phone', () => {
    test.use({ hasTouch: true });

    test('agenda first, month with dots and the day underneath, swipe between periods', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/calendar');
      await seedEvents(page, [QUIZ, BIRTHDAY]);
      await expect(page.getByRole('radio', { name: 'Agenda', checked: true })).toBeVisible();
      const agenda = page.getByRole('region', { name: 'Agenda' });
      await expect(agenda.getByRole('region', { name: 'Tomorrow' })).toContainText('Quiz');
      await expect(agenda.getByRole('region', { name: 'Fri 17 Jul' })).toContainText(
        'Niamh’s Birthday',
      );

      await agenda.getByRole('button', { name: /Quiz/ }).first().click();
      const sheet = page.getByRole('dialog', { name: 'Quiz' });
      await expect(sheet).toContainText('20:00–23:00');
      await sheet.getByRole('button', { name: 'Close' }).click();

      await page.getByRole('radio', { name: 'Month' }).click();
      await expect(period(page, 'July 2026')).toBeVisible();
      const grid = page.getByRole('grid', { name: 'Month' });
      await expect(grid.locator('[data-day="2026-07-16"] [data-testid="day-dot"]')).toHaveCount(1);
      await grid.locator('[data-day="2026-07-16"]').click();
      await expect(page.getByRole('region', { name: 'Events on Thu 16 Jul 2026' })).toContainText(
        'Quiz',
      );

      await swipe(page, -150);
      await expect(period(page, 'August 2026')).toBeVisible();
      await swipe(page, 150);
      await expect(period(page, 'July 2026')).toBeVisible();

      await page.getByRole('radio', { name: 'Week' }).click();
      await expect(period(page, '13–19 Jul 2026')).toBeVisible();
      await expect(page.locator('.ah-now-line').first()).toBeInViewport();
      await swipe(page, -150);
      await expect(period(page, '20–26 Jul 2026')).toBeVisible();
      await page.getByRole('button', { name: 'Today', exact: true }).click();
      await expect(period(page, '13–19 Jul 2026')).toBeVisible();
    });

    test('calendars panel and search', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/calendar');
      await seedEvents(page, [QUIZ, BIRTHDAY]);
      await page.getByRole('button', { name: 'Calendars' }).click();
      const panel = page.getByRole('dialog', { name: 'Calendars' });
      await panel.getByRole('switch', { name: 'Personal' }).click();
      await panel.getByRole('button', { name: 'Close' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Personal is hidden.' }),
      ).toBeVisible();
      await expect(page.getByRole('region', { name: 'Agenda' })).not.toContainText('Quiz');

      // Search still finds it, and opens its details.
      await page.getByRole('searchbox', { name: 'Search events' }).fill('qui');
      await page
        .getByRole('region', { name: 'Search results' })
        .getByRole('button', { name: /Quiz/ })
        .click();
      await expect(page.getByRole('dialog', { name: 'Quiz' })).toBeVisible();
    });
  });
});

test.describe('faster adding (Task 11.4)', () => {
  test('desktop: quick add with a preview; More options opens the form filled in', async ({
    page,
  }) => {
    await page.goto('/calendar');
    const box = page.getByRole('textbox', { name: 'Quick add' });
    await box.fill('Quiz every Thursday 8pm-12pm');
    const preview = page.getByRole('group', { name: 'Quick add preview' });
    await expect(preview).toContainText('Thu 16 Jul 2026, 20:00–00:00');
    await expect(preview).toContainText('Every Thursday · Personal');
    await box.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Added “Quiz”' })).toBeVisible();
    await expect(page.locator('.ah-calendar').getByText('Quiz', { exact: true })).toBeVisible();
    const quiz = (await readItems(page)).find((i) => i.title === 'Quiz');
    expect(quiz).toMatchObject({
      start_at: '2026-07-16T19:00:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
    });

    await box.fill('Dentist Fri 3pm');
    await page.getByRole('button', { name: 'More options' }).click();
    const form = page.getByRole('form', { name: 'New event' });
    await expect(form.getByLabel('Title')).toHaveValue('Dentist');
    await expect(form.getByLabel('Starts')).toHaveValue('2026-07-17T15:00');
    await expect(form.getByLabel('Ends')).toHaveValue('2026-07-17T16:00');
    await form.getByLabel('Repeats').selectOption('FREQ=WEEKLY');
    await form.getByLabel('End repeat').selectOption('after');
    await form.getByLabel('Times').fill('3');
    await expect(form.getByTestId('repeat-summary')).toHaveText('Every Friday, 3 times');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect
      .poll(async () => (await readItems(page)).find((i) => i.title === 'Dentist')?.rrule)
      .toBe('FREQ=WEEKLY;BYDAY=FR;COUNT=3');
  });

  test.describe('phone', () => {
    test.use({ hasTouch: true });

    test('quick add, tap an empty slot in Day and Week, add on a day in Month', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/calendar');
      await page
        .getByRole('textbox', { name: 'Quick add' })
        .fill("Niamh's birthday 17/7 every year");
      const preview = page.getByRole('group', { name: 'Quick add preview' });
      await expect(preview).toContainText('Fri 17 Jul 2026 · All day');
      await expect(preview).toContainText('Every year on 17 Jul');
      await preview.getByRole('button', { name: 'Add' }).click();
      await expect(
        page.getByRole('region', { name: 'Agenda' }).getByRole('region', { name: 'Fri 17 Jul' }),
      ).toContainText("Niamh's birthday");

      // Day view: one tap on 10:00 makes a 10:00–11:00 event.
      await page.getByRole('radio', { name: 'Day' }).click();
      const ten = await slot(page, '2026-07-15', '10:00:00');
      await page.touchscreen.tap(ten.x, ten.y);
      let form = page.getByRole('form', { name: 'New event' });
      await expect(form.getByLabel('Starts')).toHaveValue('2026-07-15T10:00');
      await expect(form.getByLabel('Ends')).toHaveValue('2026-07-15T11:00');
      await form.getByLabel('Title').fill('Coffee');
      await form.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('.ah-calendar').getByText('Coffee')).toBeVisible();

      // Week view: a tap in Friday's column at 14:00.
      await page.getByRole('radio', { name: 'Week' }).click();
      const target = await slot(page, '2026-07-17', '14:00:00');
      await page.touchscreen.tap(target.x, target.y);
      form = page.getByRole('form', { name: 'New event' });
      await expect(form.getByLabel('Starts')).toHaveValue('2026-07-17T14:00');
      await page.keyboard.press('Escape');

      // Month: pick a day, then Add event on it.
      await page.getByRole('radio', { name: 'Month' }).click();
      await page.getByRole('grid', { name: 'Month' }).locator('[data-day="2026-07-21"]').click();
      await page.getByRole('button', { name: 'Add event' }).click();
      form = page.getByRole('form', { name: 'New event' });
      await expect(form.getByLabel('Starts')).toHaveValue('2026-07-21T09:00');
    });
  });
});

test.describe('repeating events (Task 11.5)', () => {
  test('desktop: drag one occurrence asks which; "This and following" splits the series; delete one', async ({
    page,
  }) => {
    await page.goto('/calendar');
    await seedEvents(page, [QUIZ]);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(period(page, '20–26 Jul 2026')).toBeVisible();
    const target = await slot(page, '2026-07-24', '20:00:00');
    const event = page.locator('.ah-calendar').getByText('Quiz', { exact: true });
    const box = await event.boundingBox();
    if (!box) throw new Error('Quiz not drawn');
    await drag(page, { x: box.x + box.width / 2, y: box.y + 4 }, target);
    const sheet = page.getByRole('dialog', { name: 'Move repeating event' });
    const choice = sheet.getByRole('group', { name: 'Move which events?' });
    await expect(choice.getByRole('button')).toHaveText([
      'Cancel',
      'This event',
      'This and following',
      'All events',
    ]);
    await choice.getByRole('button', { name: 'This and following' }).click();
    await expect
      .poll(async () => (await readItems(page)).find((i) => i.id === QUIZ.id)?.rrule)
      .toBe('FREQ=WEEKLY;UNTIL=20260722T235959Z');
    const next = (await readItems(page)).find((i) => i.title === 'Quiz' && i.id !== QUIZ.id);
    expect(next).toMatchObject({ start_at: '2026-07-24T19:00:00.000Z', rrule: 'FREQ=WEEKLY' });

    // Back a week: delete the 16 July one on its own.
    await page.getByRole('button', { name: 'Previous' }).click();
    await page.locator('.ah-calendar').getByText('Quiz', { exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Quiz' });
    await expect(details).toContainText('Every Thursday until 22 Jul');
    await details.getByRole('button', { name: 'Delete' }).click();
    await details
      .getByRole('group', { name: 'Delete this repeating event?' })
      .getByRole('button', { name: 'This event' })
      .click();
    await expect
      .poll(async () => (await readItems(page)).find((i) => i.id === QUIZ.id)?.data?.exdates)
      .toEqual(['2026-07-16T19:00:00.000Z']);
    await expect(page.locator('.ah-calendar').getByText('Quiz', { exact: true })).toHaveCount(0);
  });

  test.describe('phone', () => {
    test.use({ hasTouch: true });

    test('edit all from one occurrence, then delete this and following', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/calendar');
      await seedEvents(page, [QUIZ]);
      const agenda = page.getByRole('region', { name: 'Agenda' });
      await agenda
        .getByRole('region', { name: 'Tomorrow' })
        .getByRole('button', { name: /Quiz/ })
        .click();
      const sheet = page.getByRole('dialog', { name: 'Quiz' });
      await expect(sheet).toContainText('Every Thursday');
      await sheet.getByRole('button', { name: 'Edit' }).click();
      const form = page.getByRole('form', { name: 'Edit event' });
      await form.getByLabel('Title').fill('Quiz night');
      await form.getByRole('button', { name: 'Save' }).click();
      await form
        .getByRole('group', { name: 'Save for which events?' })
        .getByRole('button', { name: 'All events' })
        .click();
      await expect(agenda.getByRole('region', { name: 'Tomorrow' })).toContainText('Quiz night');
      await expect(agenda.getByRole('region', { name: 'Thu 23 Jul' })).toContainText('Quiz night');

      await agenda
        .getByRole('region', { name: 'Thu 23 Jul' })
        .getByRole('button', { name: /Quiz night/ })
        .click();
      const second = page.getByRole('dialog', { name: 'Quiz night' });
      await second.getByRole('button', { name: 'Delete' }).click();
      await second
        .getByRole('group', { name: 'Delete this repeating event?' })
        .getByRole('button', { name: 'This and following' })
        .click();
      await expect(agenda.getByRole('region', { name: 'Thu 23 Jul' })).toHaveCount(0);
      await expect(agenda.getByRole('region', { name: 'Tomorrow' })).toContainText('Quiz night');
      await expect(agenda.getByRole('button', { name: /Quiz night/ })).toHaveCount(1);
    });
  });
});
