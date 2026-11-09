import { describe, expect, it } from 'vitest';
import { baseRecord, newItem } from '../db/repository';
import type { ExternalEvent, Feed, Item, LeaveBooking } from '../schemas/records';
import { DEFAULT_WORK_SETTINGS } from '../work/settings';
import {
  buildEvents,
  expandOccurrences,
  localDate,
  localMidnight,
  locationFor,
  movedTimes,
  type CalendarData,
} from './sources';

const U = '22222222-2222-4222-8222-222222222222';
const TZ = 'Europe/Dublin';
const range = (from: string, to: string) => ({
  start: new Date(localMidnight(from, TZ)),
  end: new Date(localMidnight(to, TZ)),
});
const event = (fields: Partial<Item>): Item =>
  newItem(U, { type: 'event', title: 'Event', calendar: 'personal', ...fields });
const data = (patch: Partial<CalendarData> = {}): CalendarData => ({
  items: [],
  external: [],
  feeds: [],
  leave: [],
  workDays: [],
  work: DEFAULT_WORK_SETTINGS,
  ...patch,
});
const leave = (start: string, end: string, extra: Partial<LeaveBooking> = {}): LeaveBooking => ({
  ...baseRecord(U),
  start_date: start,
  end_date: end,
  start_half: false,
  end_half: false,
  leave_type: 'annual',
  status: 'approved',
  share_us: false,
  days: null,
  note: null,
  capture_id: null,
  ...extra,
});

describe('time zone helpers', () => {
  it('local dates and midnights in Dublin, summer and winter', () => {
    expect(localMidnight('2026-07-14', TZ)).toBe('2026-07-13T23:00:00.000Z');
    expect(localMidnight('2026-12-14', TZ)).toBe('2026-12-14T00:00:00.000Z');
    expect(localDate('2026-07-13T23:30:00Z', TZ)).toBe('2026-07-14');
  });
});

describe('items on the calendar', () => {
  const week = range('2026-07-13', '2026-07-20');

  it('a timed event in the Personal source, editable', () => {
    const e = event({ start_at: '2026-07-14T14:00:00Z', end_at: '2026-07-14T15:00:00Z' });
    expect(buildEvents(data({ items: [e] }), week, TZ)).toEqual([
      expect.objectContaining({
        id: e.id,
        start: '2026-07-14T14:00:00Z',
        end: '2026-07-14T15:00:00.000Z',
        allDay: false,
        editable: true,
        extendedProps: { source: 'personal', itemId: e.id },
      }),
    ]);
  });

  it('Us events, time-blocked tasks; not suggestions, dropped or deleted items', () => {
    const items = [
      event({ calendar: 'us', title: 'Dinner', start_at: '2026-07-15T18:00:00Z' }),
      newItem(U, { type: 'task', title: 'Report', start_at: '2026-07-15T09:00:00Z' }),
      event({ status: 'suggested', start_at: '2026-07-15T10:00:00Z' }),
      event({ status: 'dropped', start_at: '2026-07-15T10:00:00Z' }),
      event({ deleted_at: '2026-07-01T00:00:00Z', start_at: '2026-07-15T10:00:00Z' }),
      newItem(U, { type: 'task', title: 'No time' }),
      event({ start_at: '2026-08-15T10:00:00Z' }),
    ];
    const out = buildEvents(data({ items }), week, TZ);
    expect(out.map((e) => [e.title, e.extendedProps.source])).toEqual([
      ['Dinner', 'us'],
      ['Report', 'tasks'],
    ]);
  });

  it('an all-day range ends the day after its last day', () => {
    const e = event({
      all_day: true,
      start_at: localMidnight('2026-07-14', TZ),
      end_at: localMidnight('2026-07-16', TZ),
    });
    expect(buildEvents(data({ items: [e] }), week, TZ)[0]).toMatchObject({
      allDay: true,
      start: '2026-07-14',
      end: '2026-07-17',
    });
  });

  it('hidden sources are left out', () => {
    const items = [
      event({ start_at: '2026-07-14T14:00:00Z' }),
      event({ calendar: 'us', start_at: '2026-07-14T14:00:00Z' }),
    ];
    const out = buildEvents(data({ items }), week, TZ, new Set(['personal', 'holidays']));
    expect(out.map((e) => e.extendedProps.source)).toEqual(['us']);
  });
});

describe('recurring items', () => {
  it('a weekly 19:00 stays at 19:00 local across the October clock change', () => {
    const training = event({
      title: 'Training',
      start_at: '2026-10-13T18:00:00Z', // Tue 19:00 IST
      end_at: '2026-10-13T19:30:00Z',
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
    });
    const occ = expandOccurrences(training, range('2026-10-12', '2026-11-02'), TZ);
    expect(occ).toEqual([
      '2026-10-13T18:00:00.000Z',
      '2026-10-20T18:00:00.000Z',
      '2026-10-27T19:00:00.000Z', // 19:00 GMT after the change on 25 October
    ]);
    const events = buildEvents(
      data({ items: [training] }),
      range('2026-10-26', '2026-11-02'),
      TZ,
      new Set(['holidays']),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: `${training.id}|2026-10-27T19:00:00.000Z`,
      start: '2026-10-27T19:00:00.000Z',
      end: '2026-10-27T20:30:00.000Z',
      // Dragging one occurrence asks this one / following / all (Task 11.5).
      editable: true,
    });
  });

  it('a yearly all-day event (birthday) appears in later years', () => {
    const bday = event({
      title: 'Mum’s birthday',
      all_day: true,
      start_at: localMidnight('2025-03-02', TZ),
      rrule: 'FREQ=YEARLY',
    });
    const out = buildEvents(data({ items: [bday] }), range('2027-03-01', '2027-03-08'), TZ);
    expect(out[0]).toMatchObject({ start: '2027-03-02', end: '2027-03-03', allDay: true });
  });

  it('a broken rule shows nothing instead of failing', () => {
    expect(
      expandOccurrences(
        event({ start_at: '2026-07-14T14:00:00Z', rrule: 'NONSENSE' }),
        range('2026-07-13', '2026-07-20'),
        TZ,
      ),
    ).toEqual([]);
  });
});

describe('linked calendars, holidays and leave', () => {
  it('linked events are read-only, in the feed colour; disabled feeds are hidden', () => {
    const feed: Feed = {
      ...baseRecord(U),
      kind: 'linked_in',
      name: 'Her calendar',
      colour: '#7c3aed',
      token_hash: null,
      url: 'https://example.test/x.ics',
      enabled: true,
      settings: {},
      last_fetched_at: null,
      last_error: null,
    };
    const ext = (title: string, feed_id: string): ExternalEvent => ({
      ...baseRecord(U),
      feed_id,
      occurrence_key: title,
      title,
      location: null,
      description: null,
      start_at: '2026-07-16T17:00:00Z',
      end_at: '2026-07-16T19:00:00Z',
      all_day: false,
    });
    const off = { ...feed, id: '33333333-3333-4333-8333-333333333333', enabled: false };
    const out = buildEvents(
      data({ feeds: [feed, off], external: [ext('Her match', feed.id), ext('Hidden', off.id)] }),
      range('2026-07-13', '2026-07-20'),
      TZ,
    );
    expect(out).toEqual([
      expect.objectContaining({
        title: 'Her match',
        color: '#7c3aed',
        editable: false,
        extendedProps: { source: `feed:${feed.id}`, externalId: expect.any(String) },
      }),
    ]);
  });

  it('public holidays and common days off are an all-day layer', () => {
    const out = buildEvents(data(), range('2026-12-21', '2026-12-28'), TZ);
    expect(out.map((e) => [e.start, e.title])).toEqual([
      ['2026-12-24', 'Christmas Eve (usual day off)'],
      ['2026-12-25', 'Christmas Day'],
      ['2026-12-26', 'St Stephen’s Day'.replace('’', "'")],
    ]);
  });

  it('leave bookings show as all-day blocks with their status', () => {
    const out = buildEvents(
      data({ leave: [leave('2026-07-14', '2026-07-17', { status: 'planned' })] }),
      range('2026-07-13', '2026-07-20'),
      TZ,
      new Set(['holidays']),
    );
    expect(out).toEqual([
      expect.objectContaining({
        title: 'Annual leave · planned',
        start: '2026-07-14',
        end: '2026-07-18',
        editable: false,
      }),
    ]);
  });
});

describe('work location', () => {
  it('pattern, override, leave, holidays and weekends', () => {
    const d = data({
      workDays: [{ ...baseRecord(U), date: '2026-07-14', location: 'client', note: null }],
      leave: [leave('2026-07-16', '2026-07-16')],
    });
    expect(locationFor('2026-07-13', d)).toBe('office'); // Monday pattern
    expect(locationFor('2026-07-14', d)).toBe('client'); // override
    expect(locationFor('2026-07-15', d)).toBe('wfh'); // Wednesday pattern
    expect(locationFor('2026-07-16', d)).toBe('off'); // leave
    expect(locationFor('2026-07-18', d)).toBe('off'); // Saturday
    expect(locationFor('2026-08-03', d)).toBe('off'); // August holiday
  });

  it('a half day of leave keeps the working location', () => {
    const d = data({ leave: [leave('2026-07-13', '2026-07-13', { end_half: true })] });
    expect(locationFor('2026-07-13', d)).toBe('office');
  });
});

describe('moving items on the calendar', () => {
  it('a timed drop keeps the given end, or defaults to an hour', () => {
    const start = new Date('2026-07-16T13:00:00Z');
    expect(movedTimes(start, new Date('2026-07-16T13:30:00Z'), false, TZ)).toEqual({
      start_at: '2026-07-16T13:00:00.000Z',
      end_at: '2026-07-16T13:30:00.000Z',
      all_day: false,
    });
    expect(movedTimes(start, null, false, TZ, 30).end_at).toBe('2026-07-16T13:30:00.000Z');
  });

  it('an all-day drop stores local midnights of the first and last day', () => {
    const start = new Date(localMidnight('2026-07-16', TZ));
    expect(movedTimes(start, new Date(localMidnight('2026-07-17', TZ)), true, TZ)).toEqual({
      start_at: '2026-07-15T23:00:00.000Z',
      end_at: null,
      all_day: true,
    });
    expect(movedTimes(start, new Date(localMidnight('2026-07-19', TZ)), true, TZ).end_at).toBe(
      '2026-07-17T23:00:00.000Z',
    );
  });
});
