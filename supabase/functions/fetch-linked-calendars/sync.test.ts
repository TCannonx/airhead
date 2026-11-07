import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import {
  normaliseUrl,
  syncFeed,
  validateLink,
  type ExternalRow,
  type LinkedStore,
} from './sync.ts';

const ics = await Deno.readTextFile(
  new URL('../../../tests/fixtures/ics/linked.ics', import.meta.url),
);
const NOW = new Date('2026-10-01T09:00:00Z');
const FEED = { id: 'f1', user_id: 'u1', url: 'webcal://calendar.example.com/her/secret.ics' };

function deps(body: string, type = 'text/calendar; charset=utf-8', status = 200) {
  const urls: string[] = [];
  return {
    urls,
    fetch: (url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(body, { status, headers: { 'content-type': type } }));
    },
    resolve: () => Promise.resolve(['93.184.216.34']),
  };
}

function memoryStore() {
  const rows = new Map<
    string,
    Omit<ExternalRow, 'deleted_at'> & { id: string; deleted_at: string | null }
  >();
  const marks: { last_fetched_at?: string; last_error: string | null }[] = [];
  let n = 0;
  const store: LinkedStore = {
    existingKeys() {
      return Promise.resolve(
        new Map(
          [...rows.values()].filter((r) => !r.deleted_at).map((r) => [r.occurrence_key, r.id]),
        ),
      );
    },
    upsert(batch) {
      for (const r of batch) {
        const id = rows.get(r.occurrence_key)?.id ?? `e${++n}`;
        rows.set(r.occurrence_key, { ...r, id, deleted_at: null });
      }
      return Promise.resolve();
    },
    softDelete(ids) {
      for (const r of rows.values()) if (ids.includes(r.id)) r.deleted_at = NOW.toISOString();
      return Promise.resolve();
    },
    markFeed(_id, patch) {
      marks.push(patch);
      return Promise.resolve();
    },
  };
  return { store, rows, marks };
}

Deno.test('webcal links are fetched over https', () => {
  assertEquals(normaliseUrl(' webcal://x.test/a.ics '), 'https://x.test/a.ics');
  assertEquals(normaliseUrl('webcals://x.test/a.ics'), 'https://x.test/a.ics');
});

Deno.test('validating a link fetches and parses it, and reports the name and size', async () => {
  const d = deps(ics);
  assertEquals(await validateLink(FEED.url, d, NOW), {
    ok: true,
    name: 'Her Us calendar',
    count: 6,
  });
  assertEquals(d.urls, ['https://calendar.example.com/her/secret.ics']);
});

Deno.test('a sign-in page or private address is rejected with a plain message', async () => {
  assertEquals(await validateLink(FEED.url, deps('<html>Sign in</html>', 'text/html'), NOW), {
    ok: false,
    error: 'That link didn’t return a calendar.',
  });
  assertEquals(await validateLink(FEED.url, deps('BEGIN:VCALENDAR', 'text/plain', 404), NOW), {
    ok: false,
    error: 'Couldn’t fetch it (HTTP 404).',
  });
  const local = { ...deps(ics), resolve: () => Promise.resolve(['10.0.0.5']) };
  assertEquals(await validateLink(FEED.url, local, NOW), {
    ok: false,
    error: 'That address isn’t allowed.',
  });
});

Deno.test('syncing upserts occurrences by key and soft-deletes ones that disappeared', async () => {
  const { store, rows, marks } = memoryStore();
  const first = await syncFeed(FEED, deps(ics), store, NOW);
  assertEquals(first, { ok: true, count: 6, removed: 0 });
  assertEquals(marks.at(-1), { last_fetched_at: NOW.toISOString(), last_error: null });
  const dinnerId = rows.get('dinner@her')?.id;

  // The dinner is dropped from her calendar; the trip moves a day.
  const changed = ics
    .replace(/BEGIN:VEVENT\r?\nUID:dinner@her[\s\S]*?END:VEVENT\r?\n/, '')
    .replace('DTSTART;VALUE=DATE:20261120', 'DTSTART;VALUE=DATE:20261121');
  const second = await syncFeed(FEED, deps(changed), store, NOW);
  assertEquals(second, { ok: true, count: 5, removed: 1 });
  assert(rows.get('dinner@her')?.deleted_at, 'the dropped event is soft-deleted');
  assertEquals(rows.get('dinner@her')?.id, dinnerId);
  assertEquals(rows.get('trip@her')?.start_at, '2026-11-21T12:00:00.000Z');
  assertEquals([...rows.values()].filter((r) => !r.deleted_at).length, 5);
});

Deno.test('a failed fetch keeps the old events and records the error on the feed', async () => {
  const { store, rows, marks } = memoryStore();
  await syncFeed(FEED, deps(ics), store, NOW);
  const res = await syncFeed(FEED, deps('nope', 'text/plain', 500), store, NOW);
  assertEquals(res, { ok: false, error: 'Couldn’t fetch it (HTTP 500).' });
  assertEquals(marks.at(-1), { last_error: 'Couldn’t fetch it (HTTP 500).' });
  assertEquals([...rows.values()].filter((r) => !r.deleted_at).length, 6);
});
