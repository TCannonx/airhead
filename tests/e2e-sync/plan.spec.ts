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
