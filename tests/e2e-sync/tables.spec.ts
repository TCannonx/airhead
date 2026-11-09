import { expect, test, type Page } from '@playwright/test';
import { schemas, SYNC_TABLES, type SyncTable } from '../../src/lib/schemas/records.ts';
import { lit, sql, userIdFor } from './db.ts';
import { signIn } from './helpers.ts';

// Every synced table through real PostgREST (TEST-MATRIX gap 12). A row for
// each table in the sync engine's own list goes into device A's local database
// with an outbox entry (what every app write does), A syncs, and device B must
// end up with the same row. Tables only the server writes get their row from
// SQL instead and must reach B. A missing column, a refused RLS policy, a
// check constraint or a schema the pull drops shows up as the named table
// missing on the server or on B. A new synced table without a row here fails
// the type check (Record<SyncTable, …>) and the first assertion.

type Row = Record<string, unknown> & { id: string };

/** Written by the server only: devices may read them, never write them. */
const SERVER_ONLY = new Set<SyncTable>(['external_events', 'briefs', 'reviews', 'scout_runs']);

function fixtures(userId: string, settings: Row | null): Record<SyncTable, Row> {
  const now = new Date().toISOString();
  const id = () => crypto.randomUUID();
  const ids = {
    capture: id(),
    note: id(),
    list: id(),
    topic: id(),
    feed: id(),
  };
  const base = (rowId: string = id()) => ({
    id: rowId,
    user_id: userId,
    created_at: now,
    updated_at: now,
    server_updated_at: null,
    deleted_at: null,
  });
  return {
    // One settings row per user: change the device's own row if it has one.
    settings: settings
      ? {
          ...settings,
          data: { ...(settings.data as object), e2e_every_table: true },
          updated_at: now,
        }
      : { ...base(), data: { e2e_every_table: true } },
    devices: {
      ...base(),
      name: 'E2E table check',
      platform: 'test',
      push_subscription: null,
      receives_notifications: false,
      last_sync_at: null,
    },
    // Already sorted, so no sorting picks it up.
    captures: {
      ...base(ids.capture),
      kind: 'text',
      text: 'every table: capture',
      url: null,
      payload: { e2e: true },
      source: 'app',
      status: 'sorted',
      captured_at: now,
      sorted_at: now,
    },
    items: {
      ...base(ids.note),
      capture_id: ids.capture,
      type: 'note',
      title: 'Every table note',
      body: null,
      data: { e2e: true },
      status: 'open',
      due_at: null,
      start_at: null,
      end_at: null,
      all_day: false,
      rrule: null,
      calendar: null,
      series_id: null,
      list_id: ids.list,
      topic_ids: [ids.topic],
      confidence: 0.5,
      top3_date: '2031-01-06',
      carry_count: 1,
      completed_at: null,
    },
    lists: { ...base(ids.list), name: 'Every table list', sort_order: 7 },
    topics: { ...base(ids.topic), name: 'Every table topic' },
    corrections: {
      ...base(),
      capture_id: ids.capture,
      from_value: { type: 'task' },
      to_value: { type: 'idea' },
    },
    memory_facts: {
      ...base(),
      text: 'Every table fact',
      category: 'everyday',
      status: 'active',
      source_capture_id: ids.capture,
      last_used_at: null,
    },
    learned_rules: {
      ...base(),
      pattern: 'every-table',
      match_kind: 'prefix',
      result: { type: 'task' },
      hits: 2,
      enabled: true,
    },
    series: {
      ...base(),
      name: 'Every table series',
      calendar: 'personal',
      colour: '#336699',
      source_kind: 'manual',
      source_path: null,
      data: { e2e: true },
    },
    // Switched off, so nothing fetches it.
    feeds: {
      ...base(ids.feed),
      kind: 'linked_in',
      name: 'Every table feed',
      colour: null,
      token_hash: null,
      url: 'https://calendar.example.test/every-table.ics',
      enabled: false,
      settings: { e2e: true },
      last_fetched_at: null,
      last_error: null,
    },
    external_events: {
      ...base(),
      feed_id: ids.feed,
      occurrence_key: 'every-table-1',
      title: 'Every table external event',
      location: 'Room 1',
      description: null,
      start_at: '2031-01-06T10:00:00.000Z',
      end_at: '2031-01-06T11:00:00.000Z',
      all_day: false,
    },
    work_days: { ...base(), date: '2031-01-06', location: 'wfh', note: 'every table' },
    leave_bookings: {
      ...base(),
      start_date: '2031-02-03',
      end_date: '2031-02-04',
      start_half: false,
      end_half: true,
      leave_type: 'annual',
      status: 'planned',
      share_us: false,
      days: 1.5,
      note: 'every table',
      capture_id: null,
    },
    briefs: {
      ...base(),
      local_date: '2031-01-06',
      status: 'fallback',
      content: { reflection: null, top3: [], also_today: [], prep: [] },
      model: null,
      cost_eur: 0,
    },
    note_docs: {
      ...base(ids.note),
      kind: 'typed',
      doc: { html: '<p>every table</p>' },
      version: 0,
      base_version: 0,
      writer_device: null,
      summary: null,
    },
    drafts: {
      ...base(),
      item_id: ids.note,
      version: 0,
      content: { summary: 'Every table draft', sections: [], open_questions: [], next_steps: [] },
      source: 'edit',
    },
    workshop_sessions: {
      ...base(ids.note),
      turns: [{ role: 'me', text: 'every table', at: now }],
      pending: null,
    },
    reviews: {
      ...base(),
      week_start: '2031-01-06',
      status: 'fallback',
      content: { e2e: true },
      digest: null,
      cost_eur: 0,
    },
    scout_runs: {
      ...base(),
      trigger: 'manual',
      queries: ['every table'],
      searches: 0,
      cards: 0,
      cost_eur: 0,
      status: 'ok',
    },
    suggestions: {
      ...base(),
      run_id: null,
      kind: 'routine',
      title: 'Every table suggestion',
      body: null,
      source_url: null,
      proposed: null,
      status: 'dismissed',
    },
    ai_actions: {
      ...base(),
      capture_id: ids.capture,
      kind: 'set_reminder',
      status: 'dismissed',
      reason: null,
      summary: 'Every table action',
      quote: 'every table',
      confidence: 0.9,
      payload: { e2e: true },
      target_table: null,
      target_id: null,
      before: null,
      after: null,
    },
  };
}

/** Opens this browser's Airhead database for the user (raw IndexedDB; Dexie stores plain objects). */
async function localRows(page: Page, userId: string, wanted: Record<string, string>) {
  return page.evaluate(
    async ({ name, wanted }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const out: Record<string, unknown> = {};
      const tx = db.transaction(Object.keys(wanted), 'readonly');
      await Promise.all(
        Object.entries(wanted).map(
          ([table, rowId]) =>
            new Promise<void>((resolve, reject) => {
              const r = tx.objectStore(table).get(rowId);
              r.onsuccess = () => {
                out[table] = r.result ?? null;
                resolve();
              };
              r.onerror = () => reject(r.error);
            }),
        ),
      );
      db.close();
      return out;
    },
    { name: `airhead-${userId}`, wanted },
  );
}

async function settingsRow(page: Page, userId: string): Promise<Row | null> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const r = db.transaction('settings').objectStore('settings').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return (rows.find((r) => !(r as { deleted_at: unknown }).deleted_at) ?? null) as Row | null;
  }, `airhead-${userId}`);
}

/** What the app's own writes do: put the row and queue it in the outbox, in one transaction. */
async function writeLocally(page: Page, userId: string, rows: Record<string, Row>) {
  await page.evaluate(
    async ({ name, rows }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const tx = db.transaction([...Object.keys(rows), 'outbox'], 'readwrite');
      const queuedAt = new Date().toISOString();
      for (const [table, row] of Object.entries(rows)) {
        tx.objectStore(table).put(row);
        tx.objectStore('outbox').add({ table, row_id: row.id, queued_at: queuedAt });
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
      // The app's sync engine runs on "online" (as after a reconnect).
      window.dispatchEvent(new Event('online'));
    },
    { name: `airhead-${userId}`, rows },
  );
}

/** Compares two copies of a row: timestamps by instant, the server's own columns ignored. */
function sameRow(table: SyncTable, sent: Row, got: Row | null): string | null {
  if (!got) return 'missing';
  const serverOwned = new Set([
    'server_updated_at',
    ...(['note_docs', 'drafts'].includes(table) ? ['version'] : []),
  ]);
  for (const [key, value] of Object.entries(sent)) {
    if (serverOwned.has(key)) continue;
    const other = got[key];
    const asTime = (v: unknown) =>
      typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : null;
    if (asTime(value) !== null && asTime(value) === asTime(other)) continue;
    if (JSON.stringify(value) !== JSON.stringify(other))
      return `${key}: sent ${JSON.stringify(value)}, got ${JSON.stringify(other)}`;
  }
  return null;
}

test.describe.configure({ timeout: 150_000 });

test('a row in every synced table goes from device A through PostgREST to device B', async ({
  browser,
}) => {
  const email = `e2e-tables-${Date.now()}@example.test`;
  const a = await (await browser.newContext()).newPage();
  await signIn(a, email);
  const b = await (await browser.newContext()).newPage();
  await signIn(b, email);
  const user = userIdFor(email);
  await expect(a.getByText('Synced', { exact: true })).toBeVisible({ timeout: 30_000 });

  const rows = fixtures(user, await settingsRow(a, user));
  expect(Object.keys(rows).sort()).toEqual([...SYNC_TABLES].sort());
  // Each row is one the app itself would accept.
  for (const table of SYNC_TABLES) {
    const parsed = schemas[table].safeParse(rows[table]);
    expect(parsed.success, `${table}: ${parsed.error?.message}`).toBe(true);
  }

  const fromDevice = Object.fromEntries(
    SYNC_TABLES.filter((t) => !SERVER_ONLY.has(t)).map((t) => [t, rows[t]]),
  );
  await writeLocally(a, user, fromDevice);

  // Every device row reaches the server (push: columns, RLS, constraints).
  const onServer = (table: string, rowId: string) =>
    sql(`select count(*) from public.${table} where id = ${lit(rowId)} and user_id = ${lit(user)}`);
  await expect
    .poll(
      () =>
        Object.keys(fromDevice)
          .filter((t) => onServer(t, (fromDevice[t] as Row).id) !== '1')
          .join(', ') || 'all there',
      { timeout: 60_000, message: 'tables whose row did not reach the server' },
    )
    .toBe('all there');

  // Rows only the server writes, written as the functions would.
  for (const table of SERVER_ONLY) {
    const row = rows[table];
    const cols = Object.keys(row)
      .filter((c) => c !== 'server_updated_at')
      .map((c) => `"${c}"`)
      .join(', ');
    sql(
      `insert into public.${table} (${cols})
         select ${cols} from jsonb_populate_record(null::public.${table}, ${lit(JSON.stringify(row))}::jsonb)`,
    );
  }

  // B ends up with every row as sent (pull: RLS on read, the schema check).
  const wanted = Object.fromEntries(SYNC_TABLES.map((t) => [t, rows[t].id]));
  let problems = '';
  await expect
    .poll(
      async () => {
        await b.evaluate(() => window.dispatchEvent(new Event('online')));
        const got = await localRows(b, user, wanted);
        problems = SYNC_TABLES.map((t) => {
          const why = sameRow(t, rows[t], got[t] as Row | null);
          return why ? `${t} (${why})` : null;
        })
          .filter(Boolean)
          .join('; ');
        return problems || 'all there';
      },
      { timeout: 90_000, intervals: [3_000], message: 'tables whose row did not reach device B' },
    )
    .toBe('all there');

  // The server numbered the note and the draft.
  const gotB = await localRows(b, user, { note_docs: rows.note_docs.id, drafts: rows.drafts.id });
  expect((gotB.note_docs as Row).version).toBe(1);
  expect((gotB.drafts as Row).version).toBe(1);
});
