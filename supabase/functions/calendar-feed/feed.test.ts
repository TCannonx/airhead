import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import ICAL from 'npm:ical.js@2.2.1';
import { holidaysBetween, irishPublicHolidays } from '../_shared/holidays/ie.ts';
import { escapeText, fold } from '../_shared/ics.ts';
import { buildFeed, type FeedInput, type FeedItem, type FeedLeave } from './feed.ts';
import { handleFeed, sha256Hex, type FeedStore } from './handler.ts';

const USER = '00000000-0000-4000-8000-00000000000a';
const T = '2026-07-01T09:00:00Z';
const item = (fields: Partial<FeedItem>): FeedItem => ({
  id: crypto.randomUUID(),
  type: 'event',
  title: 'Event',
  body: null,
  data: {},
  status: 'open',
  start_at: '2026-07-20T17:00:00Z',
  end_at: '2026-07-20T19:00:00Z',
  all_day: false,
  rrule: null,
  calendar: 'us',
  updated_at: T,
  deleted_at: null,
  ...fields,
});
const leave = (fields: Partial<FeedLeave>): FeedLeave => ({
  id: crypto.randomUUID(),
  start_date: '2026-07-27',
  end_date: '2026-07-31',
  start_half: false,
  end_half: false,
  leave_type: 'annual',
  status: 'approved',
  share_us: true,
  updated_at: T,
  deleted_at: null,
  ...fields,
});
const input = (patch: Partial<FeedInput>): FeedInput => ({
  kind: 'us_out',
  userId: USER,
  settings: {},
  items: [],
  leave: [],
  workDays: [],
  now: new Date('2026-07-15T08:00:00Z'),
  ...patch,
});

/** Parses feed text with ical.js and returns its events. */
function parse(text: string) {
  const comp = new ICAL.Component(ICAL.parse(text));
  return comp.getAllSubcomponents('vevent').map((v: ICAL.Component) => new ICAL.Event(v));
}

Deno.test('the Us feed: Us events and shared leave only, round-tripping through ical.js', () => {
  const dinner = item({
    title: 'Dinner, with friends; then drinks',
    data: { location: 'Fallon & Byrne' },
  });
  const text = buildFeed(
    input({
      items: [
        dinner,
        item({ title: 'Private dentist', calendar: 'personal' }),
        item({ title: 'Maybe', status: 'suggested' }),
        item({ title: 'Gone', deleted_at: T }),
      ],
      leave: [
        leave({}),
        leave({ share_us: false, start_date: '2026-08-10', end_date: '2026-08-10' }),
      ],
      settings: { work: { location_sharing: 'none' } },
    }),
  );
  const events = parse(text);
  assertEquals(
    events.map((e: ICAL.Event) => e.summary),
    ['Dinner, with friends; then drinks', 'Off'],
  );
  const [d, off] = events;
  assertEquals(d.uid, `${dinner.id}@airhead`);
  assertEquals(d.location, 'Fallon & Byrne');
  assertEquals(d.startDate.toJSDate().toISOString(), '2026-07-20T17:00:00.000Z');
  assertEquals(off.startDate.toString(), '2026-07-27');
  assertEquals(off.endDate.toString(), '2026-08-01');
  assertStringIncludes(text, 'X-WR-CALNAME:Us (Airhead)');
  assert(text.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
});

Deno.test('recurring events keep their local time across the clock change', () => {
  const training = item({
    title: 'Training',
    calendar: 'us',
    start_at: '2026-10-13T18:00:00Z', // Tue 19:00 IST
    end_at: '2026-10-13T19:30:00Z',
    rrule: 'FREQ=WEEKLY;BYDAY=TU',
  });
  const [e] = parse(
    buildFeed(input({ items: [training], settings: { work: { location_sharing: 'none' } } })),
  );
  const it = e.iterator();
  const starts = [it.next(), it.next(), it.next()].map((t: ICAL.Time) =>
    t.toJSDate().toISOString(),
  );
  assertEquals(starts, [
    '2026-10-13T18:00:00.000Z',
    '2026-10-20T18:00:00.000Z',
    '2026-10-27T19:00:00.000Z',
  ]);
});

Deno.test('work location on the Us feed: full, "Working" only, or nothing', () => {
  const settings = (location_sharing: string) => ({ work: { location_sharing } });
  const now = new Date('2026-07-15T08:00:00Z');
  const onDay = (text: string, day: string) =>
    parse(text)
      .filter((e: ICAL.Event) => e.startDate.toString() === day)
      .map((e: ICAL.Event) => e.summary);
  const full = buildFeed(input({ settings: settings('full'), now, leave: [leave({})] }));
  assertEquals(onDay(full, '2026-07-14'), ['Office']); // Tuesday
  assertEquals(onDay(full, '2026-07-15'), ['WFH']); // Wednesday
  assertEquals(onDay(full, '2026-07-18'), []); // Saturday
  assertEquals(onDay(full, '2026-08-03'), []); // bank holiday
  assertEquals(onDay(full, '2026-07-27'), ['Off']); // the shared leave block starts here
  assertEquals(onDay(full, '2026-07-28'), []); // on leave: no location marker
  const working = buildFeed(input({ settings: settings('working'), now }));
  assertEquals(onDay(working, '2026-07-14'), ['Working']);
  const none = buildFeed(input({ settings: settings('none'), now }));
  assertEquals(parse(none).length, 0);
});

Deno.test('my own feed has everything: Personal, Us, time blocks, all leave, notes', () => {
  const text = buildFeed(
    input({
      kind: 'me_out',
      items: [
        item({ title: 'Dentist', calendar: 'personal', body: 'Bring card' }),
        item({ title: 'Report', type: 'task', calendar: null }),
        item({ title: 'Untimed task', type: 'task', start_at: null }),
      ],
      leave: [leave({ share_us: false, status: 'planned' })],
      settings: { work: { location_sharing: 'none' } },
    }),
  );
  const summaries = parse(text).map((e: ICAL.Event) => e.summary);
  assert(summaries.includes('Dentist'));
  assert(summaries.includes('Task: Report'));
  assert(summaries.includes('Annual leave · planned'));
  assert(summaries.includes('Office'), 'my own feed always shows locations');
  assert(!summaries.includes('Untimed task'));
  assertStringIncludes(text, 'DESCRIPTION:Bring card');
});

Deno.test('text escaping and line folding', () => {
  assertEquals(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const long = `SUMMARY:${'é'.repeat(60)}`;
  const folded = fold(long);
  assert(folded.split('\r\n ').every((l) => new TextEncoder().encode(l).length <= 75));
  assertEquals(folded.replace(/\r\n /g, ''), long);
});

Deno.test('the shared holiday copy matches the app (same dates as its tests)', () => {
  assertEquals(
    irishPublicHolidays(2027).map((h) => h.date),
    [
      '2027-01-01',
      '2027-02-01',
      '2027-03-17',
      '2027-03-29',
      '2027-05-03',
      '2027-06-07',
      '2027-08-02',
      '2027-10-25',
      '2027-12-25',
      '2027-12-26',
    ],
  );
  assertEquals(holidaysBetween('2030-02-01', '2030-02-01')[0]?.name, "St Brigid's Day");
});

// Handler -------------------------------------------------------------------------
const TOKEN = 'k3y-Example_token_that_is_long_enough_000000';
function store(feed: { kind: string; enabled: boolean; deleted: boolean } | null): FeedStore {
  return {
    async findFeed(hash) {
      if (!feed || hash !== (await sha256Hex(TOKEN))) return null;
      return {
        user_id: USER,
        kind: feed.kind as 'us_out',
        enabled: feed.enabled,
        deleted_at: feed.deleted ? T : null,
      };
    },
    async loadData() {
      return { settings: {}, items: [item({ title: 'Dinner' })], leave: [], workDays: [] };
    },
  };
}
const get = (token: string | null, s: FeedStore) =>
  handleFeed(
    new Request(`https://x.test/calendar-feed${token ? `?t=${token}` : ''}`),
    s,
    new Date('2026-07-15T08:00:00Z'),
  );

Deno.test('a valid token returns the calendar', async () => {
  const res = await get(TOKEN, store({ kind: 'us_out', enabled: true, deleted: false }));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get('content-type') ?? '', 'text/calendar');
  assertStringIncludes(await res.text(), 'SUMMARY:Dinner');
});

Deno.test('a revoked, disabled, unknown or missing token returns 404', async () => {
  for (const s of [
    store({ kind: 'us_out', enabled: true, deleted: true }),
    store({ kind: 'us_out', enabled: false, deleted: false }),
    store({ kind: 'linked_in', enabled: true, deleted: false }),
    store(null),
  ]) {
    const res = await get(TOKEN, s);
    assertEquals(res.status, 404);
    await res.body?.cancel();
  }
  const wrong = await get('wrong-token', store({ kind: 'us_out', enabled: true, deleted: false }));
  assertEquals(wrong.status, 404);
  await wrong.body?.cancel();
  const missing = await get(null, store({ kind: 'us_out', enabled: true, deleted: false }));
  assertEquals(missing.status, 404);
  await missing.body?.cancel();
});
