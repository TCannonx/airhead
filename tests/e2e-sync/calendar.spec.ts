import { expect, test, type Browser, type Page } from '@playwright/test';
import { signIn } from './helpers.ts';

// Missing events (Task 11.7): a weekly timed event, a yearly all-day event and
// a one-off all-day event made on device A stay visible in Day, Week, Month and
// Agenda on A after its sync and on B (a phone) after the sync reaches it.

const TZ = 'Europe/Dublin';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
const monday = (key: string) => addDays(key, -((weekday(key) + 6) % 7));
const dayTitle = (key: string) =>
  `${WEEKDAYS[weekday(key)]} ${Number(key.slice(8))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const TITLES = ['Quiz', 'Niamh’s Birthday', 'Training'];

async function newDevice(browser: Browser, width: number, height: number) {
  const ctx = await browser.newContext({ timezoneId: TZ, viewport: { width, height } });
  return ctx.newPage();
}

async function addEvent(
  page: Page,
  e: { title: string; day: string; allDay: boolean; repeat: string },
) {
  await page.getByRole('button', { name: 'New event' }).click();
  const form = page.getByRole('form', { name: 'New event' });
  await form.getByLabel('Title').fill(e.title);
  if (e.allDay) {
    await form.getByRole('switch', { name: 'All day' }).click();
    await form.getByLabel('From').fill(e.day);
    await form.getByLabel('To').fill(e.day);
  } else {
    await form.getByLabel('Starts').fill(`${e.day}T20:00`);
    await form.getByLabel('Ends').fill(`${e.day}T23:00`);
  }
  await form.getByLabel('Repeats').selectOption(e.repeat);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

async function expectAll(where: ReturnType<Page['locator']>, timeout = 15_000) {
  for (const t of TITLES) await expect(where).toContainText(t, { timeout });
}

/** Every view shows the three events on `day`; `firstTimeout` waits for sync. */
async function checkViews(page: Page, day: string, phone: boolean, firstTimeout = 15_000) {
  const today = dayKey(new Date());
  const view = (name: string) => page.getByRole('radio', { name }).click();
  const toToday = () => page.getByRole('button', { name: 'Today', exact: true }).click();
  const next = () => page.getByRole('button', { name: 'Next' }).click();

  await view('Agenda');
  await toToday();
  await expectAll(
    page.getByRole('region', { name: 'Agenda' }).getByRole('region', { name: 'Tomorrow' }),
    firstTimeout,
  );

  await view('Day');
  await toToday();
  await next();
  await expect(page.getByRole('heading', { level: 2, name: dayTitle(day) })).toBeVisible();
  await expectAll(page.locator('.ah-calendar'));

  await view('Week');
  await toToday();
  if (monday(day) !== monday(today)) await next();
  await expectAll(page.locator('.ah-calendar'));

  await view('Month');
  await toToday();
  if (day.slice(0, 7) !== today.slice(0, 7)) await next();
  if (phone) {
    await page.getByRole('grid', { name: 'Month' }).locator(`[data-day="${day}"]`).click();
    await expectAll(page.getByRole('region', { name: `Events on ${dayTitle(day)}` }));
  } else {
    await expectAll(page.locator('.ah-calendar'));
  }
}

test('events made on one device stay visible in every view on both devices', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const email = `e2e-calendar-${Date.now()}@example.test`;
  const day = addDays(dayKey(new Date()), 1);

  const a = await newDevice(browser, 1280, 900);
  await signIn(a, email);
  const b = await newDevice(browser, 390, 844);
  await signIn(b, email);
  await b.goto('/calendar');
  await expect(b.getByRole('radio', { name: 'Agenda', checked: true })).toBeVisible();

  await a.goto('/calendar');
  await addEvent(a, { title: 'Quiz', day, allDay: false, repeat: 'FREQ=WEEKLY' });
  await addEvent(a, { title: 'Niamh’s Birthday', day, allDay: true, repeat: 'FREQ=YEARLY' });
  await addEvent(a, { title: 'Training', day, allDay: true, repeat: '' });

  // Device A straight away.
  await checkViews(a, day, false);

  // Device B, a phone already on the calendar: the sync brings them in.
  await checkViews(b, day, true, 60_000);
  await b.reload();
  await checkViews(b, day, true);

  // Device A after a reload: its pull has replaced the local rows with the server's copies.
  await a.reload();
  await checkViews(a, day, false);
});

const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The Agenda's day heading: "Tomorrow", "Thu 19 Nov", with the year when it is not this year's. */
function agendaLabel(key: string, today: string) {
  if (key === addDays(today, 1)) return 'Tomorrow';
  const label = dayTitle(key);
  return key.slice(0, 4) === today.slice(0, 4) ? label.slice(0, -5) : label;
}

/** One day of the Agenda: its text, or '' when the day has nothing on. */
async function agendaDay(page: Page, key: string, today: string) {
  const region = page
    .getByRole('region', { name: 'Agenda' })
    .getByRole('region', { name: agendaLabel(key, today), exact: true });
  return (await region.count()) ? ((await region.textContent()) ?? '') : '';
}

async function expectSwims(page: Page, d: string, today: string, timeout = 15_000) {
  await expect.poll(() => agendaDay(page, d, today), { timeout }).toContain('Swim');
  await expect
    .poll(() => agendaDay(page, addDays(d, 14), today), { timeout })
    .toContain('Swim gala');
  await expect.poll(() => agendaDay(page, addDays(d, 7), today)).not.toContain('Swim');
  const changed = await agendaDay(page, addDays(d, 14), today);
  expect(changed).toContain('09:00');
  expect(changed).not.toContain('07:00');
  await expect.poll(() => agendaDay(page, addDays(d, 21), today)).toContain('07:00');
}

test('one occurrence deleted and one changed on device A show the same on device B (Task 11.5)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const email = `e2e-repeat-${Date.now()}@example.test`;
  const today = dayKey(new Date());
  const d = addDays(today, 1);

  const a = await newDevice(browser, 1280, 900);
  await signIn(a, email);
  const b = await newDevice(browser, 390, 844);
  await signIn(b, email);
  await b.goto('/calendar');

  // Device A: quick add a weekly swim starting tomorrow.
  await a.goto('/calendar');
  await a.getByRole('radio', { name: 'Agenda' }).click();
  const quick = a.getByRole('textbox', { name: 'Quick add' });
  await quick.fill(`Swim every ${LONG_DAYS[weekday(d)]} 7am`);
  await expect(a.getByRole('group', { name: 'Quick add preview' })).toContainText(
    `${dayTitle(d)}, 07:00–08:00`,
  );
  await quick.press('Enter');
  await expect.poll(() => agendaDay(a, addDays(d, 7), today)).toContain('Swim');

  // Delete next week's on its own.
  const agenda = a.getByRole('region', { name: 'Agenda' });
  await agenda
    .getByRole('region', { name: agendaLabel(addDays(d, 7), today), exact: true })
    .getByRole('button', { name: /Swim/ })
    .click();
  let sheet = a.getByRole('dialog', { name: 'Swim' });
  await sheet.getByRole('button', { name: 'Delete' }).click();
  await sheet
    .getByRole('group', { name: 'Delete this repeating event?' })
    .getByRole('button', { name: 'This event' })
    .click();

  // Change the one after: a gala at 09:00, this event only.
  await agenda
    .getByRole('region', { name: agendaLabel(addDays(d, 14), today), exact: true })
    .getByRole('button', { name: /Swim/ })
    .click();
  sheet = a.getByRole('dialog', { name: 'Swim' });
  await sheet.getByRole('button', { name: 'Edit' }).click();
  const form = a.getByRole('form', { name: 'Edit event' });
  await form.getByLabel('Title').fill('Swim gala');
  await form.getByLabel('Starts').fill(`${addDays(d, 14)}T09:00`);
  await form.getByLabel('Ends').fill(`${addDays(d, 14)}T10:00`);
  await form.getByRole('button', { name: 'Save' }).click();
  await form
    .getByRole('group', { name: 'Save for which events?' })
    .getByRole('button', { name: 'This event' })
    .click();
  await expect(form).toHaveCount(0);
  await expectSwims(a, d, today);

  // Device B, a phone on the Agenda: the sync brings the exception and the change.
  await expectSwims(b, d, today, 60_000);
  await b.reload();
  await expectSwims(b, d, today);

  // Device A after its pull has replaced its rows with the server's copies.
  await a.reload();
  await a.getByRole('radio', { name: 'Agenda' }).click();
  await expectSwims(a, d, today);
});
