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
      new Promise<{ id: string; title: string; type: string; start_at: string | null }[]>(
        (resolve, reject) => {
          const req = indexedDB.open(`airhead-${user}`);
          req.onerror = () => reject(new Error('open failed'));
          req.onsuccess = () => {
            const all = req.result.transaction('items').objectStore('items').getAll();
            all.onsuccess = () => {
              resolve(all.result as never);
              req.result.close();
            };
          };
        },
      ),
    LOCAL_USER,
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A fixed "now": Wednesday 15 July 2026, 08:00 in Dublin.
  await page.clock.setFixedTime(new Date('2026-07-15T07:00:00Z'));
});

test('create an event from an empty slot, then drag it to another day', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByRole('button', { name: 'Week', pressed: true })).toBeVisible();

  const start = await slot(page, '2026-07-15', '10:00:00');
  await page.mouse.click(start.x, start.y);
  const editor = page.getByRole('form', { name: 'New event' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Title').fill('Dentist');
  await editor.getByRole('button', { name: 'Save' }).click();

  const event = page.getByText('Dentist', { exact: true });
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
  await page.getByRole('button', { name: 'Month' }).click();
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
