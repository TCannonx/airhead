import { afterEach, describe, expect, it } from 'vitest';
import { newItem } from '../db/repository';
import type { Feed, Item } from '../schemas/records';
import { DEFAULT_WORK_SETTINGS } from '../work/settings';
import { buildEvents, localMidnight, type CalendarData } from './sources';
import {
  agendaGroups,
  dayLabel,
  periodRange,
  periodTitle,
  readHidden,
  readView,
  repeatWords,
  searchEvents,
  shiftPeriod,
  whenText,
  writeHidden,
  writeView,
  type CalView,
} from './view';

const U = '22222222-2222-4222-8222-222222222222';
const TZ = 'Europe/Dublin';
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
const rangeOf = (view: CalView, anchor: string) => {
  const { from, to } = periodRange(view, anchor);
  return { start: new Date(localMidnight(from, TZ)), end: new Date(localMidnight(to, TZ)) };
};

afterEach(() => localStorage.clear());

describe('periods and titles', () => {
  it('week runs Monday to Sunday; titles read like other calendars', () => {
    expect(periodRange('week', '2026-11-12')).toEqual({ from: '2026-11-09', to: '2026-11-16' });
    expect(periodTitle('week', '2026-11-12', '2026-11-09')).toBe('9–15 Nov 2026');
    expect(periodTitle('week', '2026-12-01', '2026-11-09')).toBe('30 Nov – 6 Dec 2026');
    expect(periodTitle('week', '2026-12-31', '2026-11-09')).toBe('28 Dec 2026 – 3 Jan 2027');
    expect(periodTitle('month', '2026-11-12', '2026-11-09')).toBe('November 2026');
    expect(periodTitle('day', '2026-11-12', '2026-11-09')).toBe('Thu 12 Nov 2026');
    expect(periodTitle('agenda', '2026-11-09', '2026-11-09')).toBe('Next 30 days');
  });

  it('previous and next move by a day, a week, a month or 30 days', () => {
    expect(shiftPeriod('day', '2026-11-09', 1)).toBe('2026-11-10');
    expect(shiftPeriod('week', '2026-11-09', -1)).toBe('2026-11-02');
    expect(shiftPeriod('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftPeriod('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftPeriod('agenda', '2026-11-09', 1)).toBe('2026-12-09');
  });

  it('the month grid starts on the Monday before the 1st and has six weeks', () => {
    expect(periodRange('month', '2026-11-20')).toEqual({ from: '2026-10-26', to: '2026-12-07' });
  });

  it('day headers say Today, Tomorrow, then the date', () => {
    expect(dayLabel('2026-11-09', '2026-11-09')).toBe('Today');
    expect(dayLabel('2026-11-10', '2026-11-09')).toBe('Tomorrow');
    expect(dayLabel('2026-11-12', '2026-11-09')).toBe('Thu 12 Nov');
    expect(dayLabel('2027-01-05', '2026-11-09')).toBe('Tue 5 Jan 2027');
  });
});

describe('remembered per device', () => {
  it('the view: Agenda on the phone and Week elsewhere until one is chosen', () => {
    expect(readView('phone')).toBe('agenda');
    expect(readView('desktop')).toBe('week');
    writeView('month');
    expect(readView('phone')).toBe('month');
    localStorage.setItem('airhead.calendar.view', 'nonsense');
    expect(readView('tablet')).toBe('week');
  });

  it('hidden calendars survive a reload and bad stored values are ignored', () => {
    writeHidden(new Set(['us', 'feed:abc']));
    expect([...readHidden()]).toEqual(['us', 'feed:abc']);
    localStorage.setItem('airhead.calendar.hidden', '{bad');
    expect(readHidden().size).toBe(0);
  });
});

describe('the agenda', () => {
  it('groups by day, all-day first then by time; a long event shows on each day', () => {
    const items = [
      event({ title: 'Quiz', start_at: '2026-11-12T20:00:00Z', end_at: '2026-11-13T00:00:00Z' }),
      event({ title: 'Coffee', start_at: '2026-11-12T09:00:00Z', end_at: '2026-11-12T09:30:00Z' }),
      event({
        title: 'Trip',
        all_day: true,
        start_at: '2026-11-12T00:00:00Z',
        end_at: '2026-11-13T00:00:00Z',
      }),
      event({ title: 'Late', start_at: '2026-11-14T22:00:00Z', end_at: '2026-11-15T02:00:00Z' }),
    ];
    const events = buildEvents(data({ items }), rangeOf('agenda', '2026-11-09'), TZ);
    const groups = agendaGroups(events, '2026-11-09', '2026-12-09', TZ);
    expect(groups.map((g) => [g.date, g.entries.map((e) => `${e.time} ${e.event.title}`)])).toEqual(
      [
        ['2026-11-12', ['All day Trip', '09:00 Coffee', '20:00 Quiz']],
        ['2026-11-13', ['All day Trip']],
        ['2026-11-14', ['22:00 Late']],
        ['2026-11-15', ['Until 02:00 Late']],
      ],
    );
    expect(groups[0]?.entries[2]?.endTime).toBe('00:00');
  });

  it('nothing in range gives no groups (the page shows an empty state)', () => {
    expect(agendaGroups([], '2026-11-09', '2026-12-09', TZ)).toEqual([]);
  });
});

describe('when and repeat in words', () => {
  it('timed, all-day and multi-day', () => {
    const [timed] = buildEvents(
      data({
        items: [event({ start_at: '2026-11-12T20:00:00Z', end_at: '2026-11-13T00:00:00Z' })],
      }),
      rangeOf('week', '2026-11-12'),
      TZ,
    );
    expect(timed && whenText(timed, TZ)).toBe('Thu 12 Nov 2026, 20:00–00:00');
    const [allDay] = buildEvents(
      data({ items: [event({ all_day: true, start_at: '2026-11-11T00:00:00Z' })] }),
      rangeOf('week', '2026-11-12'),
      TZ,
    );
    expect(allDay && whenText(allDay, TZ)).toBe('Wed 11 Nov 2026 · All day');
    const [span] = buildEvents(
      data({
        items: [
          event({
            all_day: true,
            start_at: '2026-11-10T00:00:00Z',
            end_at: '2026-11-12T00:00:00Z',
          }),
        ],
      }),
      rangeOf('week', '2026-11-12'),
      TZ,
    );
    expect(span && whenText(span, TZ)).toBe('Tue 10 Nov 2026 – Thu 12 Nov 2026 · All day');
    expect(repeatWords('FREQ=WEEKLY;BYDAY=TH')).toBe('Every week on Thursday');
    expect(repeatWords('RRULE:FREQ=YEARLY')).toBe('Every year');
  });
});

describe('search', () => {
  const now = new Date('2026-11-09T10:00:00Z');
  const feed: Feed = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: U,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    server_updated_at: null,
    deleted_at: null,
    kind: 'linked_in',
    name: 'Work',
    colour: '#0f766e',
    token_hash: null,
    url: 'https://example.test/cal.ics',
    enabled: true,
    settings: {},
    last_fetched_at: null,
    last_error: null,
  };

  it('finds past and future events by title, a repeat once at its next time, linked ones too', () => {
    const d = data({
      feeds: [feed],
      items: [
        event({
          title: 'Quiz night',
          start_at: '2026-10-01T19:00:00Z',
          rrule: 'FREQ=WEEKLY;BYDAY=TH',
        }),
        event({ title: 'Old quiz', start_at: '2026-03-01T19:00:00Z' }),
        event({ title: 'Dentist', start_at: '2026-12-01T09:00:00Z' }),
        event({ title: 'Unsure quiz', status: 'suggested', start_at: '2026-12-01T09:00:00Z' }),
      ],
      external: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          user_id: U,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          server_updated_at: null,
          deleted_at: null,
          feed_id: feed.id,
          occurrence_key: 'k',
          title: 'Team quiz',
          location: null,
          description: null,
          start_at: '2026-11-20T12:00:00Z',
          end_at: '2026-11-20T13:00:00Z',
          all_day: false,
        },
      ],
    });
    const { upcoming, past } = searchEvents(d, '  QUIZ ', now, TZ);
    expect(upcoming.map((h) => [h.event.title, h.event.start])).toEqual([
      ['Quiz night', '2026-11-12T20:00:00.000Z'],
      ['Team quiz', '2026-11-20T12:00:00Z'],
    ]);
    expect(past.map((h) => h.event.title)).toEqual(['Old quiz']);
    expect(searchEvents(d, ' ', now, TZ)).toEqual({ upcoming: [], past: [] });
  });
});

describe('missing events (Task 11.7): the owner’s three events stay visible', () => {
  // As the server sends them back after a sync: offset timestamps, microseconds,
  // the weekly quiz with and without its end time, all-day items at local midnight.
  const owner = (quizEnd: string | null) => [
    event({
      title: 'Quiz',
      start_at: '2026-11-12T20:00:00.123456+00:00',
      end_at: quizEnd,
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
    }),
    event({
      title: 'Niamh’s Birthday',
      all_day: true,
      start_at: '2026-11-11T00:00:00+00:00',
      end_at: null,
      rrule: 'FREQ=YEARLY',
    }),
    event({ title: 'Training', all_day: true, start_at: '2026-11-10T00:00:00+00:00' }),
  ];
  // What a view shows: the events whose days fall inside its period.
  const titles = (items: Item[], view: CalView, anchor: string) => {
    const { from, to } = periodRange(view, anchor);
    const events = buildEvents(data({ items }), rangeOf(view, anchor), TZ, new Set(['holidays']));
    return [
      ...new Set(
        agendaGroups(events, from, to, TZ).flatMap((g) => g.entries.map((e) => e.event.title)),
      ),
    ].sort();
  };
  const all = ['Niamh’s Birthday', 'Quiz', 'Training'];

  for (const end of [null, '2026-11-13T00:00:00+00:00']) {
    it(`in Day, Week, Month and Agenda (quiz end ${end ?? 'missing'})`, () => {
      const items = owner(end);
      expect(titles(items, 'week', '2026-11-09')).toEqual(all);
      expect(titles(items, 'month', '2026-11-09')).toEqual(all);
      expect(titles(items, 'agenda', '2026-11-09')).toEqual(all);
      expect(titles(items, 'day', '2026-11-10')).toEqual(['Training']);
      expect(titles(items, 'day', '2026-11-11')).toEqual(['Niamh’s Birthday']);
      expect(titles(items, 'day', '2026-11-12')).toEqual(['Quiz']);
      // The agenda opened late in the day still lists today's all-day event.
      const agenda = agendaGroups(
        buildEvents(data({ items }), rangeOf('agenda', '2026-11-10'), TZ, new Set(['holidays'])),
        '2026-11-10',
        '2026-12-10',
        TZ,
      );
      expect(agenda[0]?.entries.map((e) => e.event.title)).toEqual(['Training']);
      // Next week and next year the repeats are still there.
      expect(titles(items, 'week', '2026-11-19')).toEqual(['Quiz']);
      // 11 Nov 2027 is a Thursday: the birthday and the quiz.
      expect(titles(items, 'day', '2027-11-11')).toEqual(['Niamh’s Birthday', 'Quiz']);
    });
  }

  it('each occurrence has its own id, stable across re-renders', () => {
    const items = owner(null);
    const a = buildEvents(data({ items }), rangeOf('month', '2026-11-09'), TZ).map((e) => e.id);
    const b = buildEvents(data({ items }), rangeOf('month', '2026-11-09'), TZ).map((e) => e.id);
    expect(new Set(a).size).toBe(a.length);
    expect(b).toEqual(a);
  });

  it('a hidden calendar is the only thing that removes them, and search still finds them', () => {
    const items = owner(null);
    expect(
      buildEvents(data({ items }), rangeOf('week', '2026-11-09'), TZ, new Set(['personal'])),
    ).toEqual([]);
    const { upcoming } = searchEvents(
      data({ items }),
      'quiz',
      new Date('2026-11-09T10:00:00Z'),
      TZ,
    );
    expect(upcoming.map((h) => h.event.title)).toEqual(['Quiz']);
  });
});
