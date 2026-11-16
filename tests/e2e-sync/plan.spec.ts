import { expect, test } from '@playwright/test';
import { lit, sql, userIdFor, waitForSql } from './db.ts';
import { signIn } from './helpers.ts';

// Defaults applied on save (Task 13.3): an early event made on a device is
// queued by the items trigger; one scheduler tick (what pg_cron runs every
// minute) writes a "prepare" nudge for 20:30 the evening before and a "leave"
// nudge for 07:20, and both reach a second device. The event is two days out
// so the evening-before time is never already past when CI runs late in the day.

const TZ = 'Europe/Dublin';
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** A Dublin wall time as HH:MM for an ISO instant. */
const wall = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

test.describe.configure({ timeout: 150_000 });

test('an event at 08:00 gets a prepare the evening before and a leave at 07:20, on both devices', async ({
  browser,
}) => {
  const email = `e2e-plan-${Date.now()}@example.test`;
  const a = await (await browser.newContext({ timezoneId: TZ })).newPage();
  await signIn(a, email);
  const b = await (await browser.newContext({ timezoneId: TZ })).newPage();
  await signIn(b, email);
  const user = userIdFor(email);

  const day = addDays(dayKey(new Date()), 2);
  await a.goto('/calendar');
  await a.getByRole('button', { name: 'New event' }).click();
  const form = a.getByRole('form', { name: 'New event' });
  await form.getByLabel('Title').fill('Training');
  await form.getByLabel('Starts').fill(`${day}T08:00`);
  await form.getByLabel('Ends').fill(`${day}T09:30`);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  const itemId = await (async () => {
    const q = `select id from public.items where user_id = ${lit(user)} and title = 'Training' and deleted_at is null`;
    await expect.poll(() => sql(q), { timeout: 60_000 }).not.toBe('');
    return sql(q);
  })();

  // One tick drains the queue.
  sql('select public.dispatch_scheduler_tick()');
  await waitForSql(
    `select count(*) from public.nudges where item_id = ${lit(itemId)} and status = 'pending'
       and source = 'default' and dedupe_key like 'plan:%'`,
    '2',
    60_000,
  );
  const rows = sql(
    `select kind || '|' || (to_json(send_at) #>> '{}') from public.nudges where item_id = ${lit(itemId)}
       and dedupe_key like 'plan:%' order by send_at`,
  )
    .split('\n')
    .map((r) => r.split('|'));
  expect(rows.map(([k]) => k)).toEqual(['prepare', 'leave']);
  const [prepare = '', leave = ''] = rows.map(([, at]) => new Date(at ?? '').toISOString());
  expect([dayKey(new Date(prepare)), wall(prepare)]).toEqual([addDays(day, -1), '20:30']);
  expect([dayKey(new Date(leave)), wall(leave)]).toEqual([day, '07:20']);

  // The nudges reach device B (pull-only table).
  await expect
    .poll(
      async () => {
        await b.evaluate(() => window.dispatchEvent(new Event('online')));
        return b.evaluate(
          async ({ name, itemId }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const r = indexedDB.open(name);
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
            const all = await new Promise<
              { item_id: string; kind: string; dedupe_key: string | null }[]
            >((resolve, reject) => {
              const r = db.transaction('nudges').objectStore('nudges').getAll();
              r.onsuccess = () =>
                resolve(r.result as { item_id: string; kind: string; dedupe_key: string | null }[]);
              r.onerror = () => reject(r.error);
            });
            db.close();
            return all
              .filter((n) => n.item_id === itemId && (n.dedupe_key ?? '').startsWith('plan:'))
              .map((n) => n.kind)
              .sort()
              .join(',');
          },
          { name: `airhead-${user}`, itemId },
        );
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .toBe('leave,prepare');
});

/** Rows of `nudges` in device B's local database for an item, as "dedupe_key|outcome". */
async function deviceNudges(
  page: import('@playwright/test').Page,
  user: string,
  itemId: string,
): Promise<string> {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  return page.evaluate(
    async ({ name, itemId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const all = await new Promise<
        { item_id: string; dedupe_key: string | null; outcome: string | null; source: string }[]
      >((resolve, reject) => {
        const r = db.transaction('nudges').objectStore('nudges').getAll();
        r.onsuccess = () => resolve(r.result as never);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return all
        .filter(
          (n) => n.item_id === itemId && (n.dedupe_key ?? '').match(/^(plan:prepare|snooze:)/),
        )
        .map((n) => `${(n.dedupe_key ?? '').split(':')[0]}|${n.source}|${n.outcome ?? ''}`)
        .sort()
        .join(',');
    },
    { name: `airhead-${user}`, itemId },
  );
}

test('snoozing a reminder on one device shows the new time and the outcome on the other (Task 13.8)', async ({
  browser,
}) => {
  const email = `e2e-snooze-${Date.now()}@example.test`;
  const a = await (await browser.newContext({ timezoneId: TZ })).newPage();
  await signIn(a, email);
  const b = await (await browser.newContext({ timezoneId: TZ })).newPage();
  await signIn(b, email);
  const user = userIdFor(email);

  const day = addDays(dayKey(new Date()), 2);
  await a.goto('/calendar');
  await a.getByRole('button', { name: 'New event' }).click();
  const form = a.getByRole('form', { name: 'New event' });
  await form.getByLabel('Title').fill('Training');
  await form.getByLabel('Starts').fill(`${day}T08:00`);
  await form.getByLabel('Ends').fill(`${day}T09:30`);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  const q = `select id from public.items where user_id = ${lit(user)} and title = 'Training' and deleted_at is null`;
  await expect.poll(() => sql(q), { timeout: 60_000 }).not.toBe('');
  const itemId = sql(q);
  sql('select public.dispatch_scheduler_tick()');
  const prepQ = `select id from public.nudges where item_id = ${lit(itemId)} and dedupe_key like 'plan:prepare:%'`;
  await expect.poll(() => sql(prepQ), { timeout: 60_000 }).not.toBe('');
  const nudgeId = sql(prepQ);

  // The nudge reaches A, then a tap on its notification opens the item with the sheet.
  await expect
    .poll(() => deviceNudges(a, user, itemId), { timeout: 60_000, intervals: [3_000] })
    .toBe('plan|default|');
  await a.goto(`/library/item/${itemId}?nudge=${nudgeId}`);
  const sheet = a.getByRole('dialog');
  await sheet.getByRole('button', { name: /^In an hour/ }).click();
  await expect(sheet).toHaveCount(0);

  await waitForSql(
    `select outcome || '/' || (select source from public.nudges s where s.dedupe_key = 'snooze:' || n.id)
       from public.nudges n where n.id = ${lit(nudgeId)}`,
    'snoozed/user',
    30_000,
  );
  await expect
    .poll(() => deviceNudges(b, user, itemId), { timeout: 60_000, intervals: [3_000] })
    .toBe('plan|default|snoozed,snooze|user|');
});
