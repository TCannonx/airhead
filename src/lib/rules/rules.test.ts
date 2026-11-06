import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { RRule } from 'rrule';
import { describe, expect, it } from 'vitest';
import { analyseCapture } from './index';

const TZ = 'Europe/Dublin';
// Friday 6 November 2026, 10:00 in Dublin (GMT at this time of year).
const NOW = new Date('2026-11-06T10:00:00Z');
const local = (iso: string, allDay: boolean) =>
  format(new TZDate(iso, TZ), allDay ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');

interface Expect {
  when?: null | {
    start: string;
    end?: string;
    allDay?: boolean;
    confident: boolean;
    rrule?: string;
  };
  title?: string;
  kind?: 'text' | 'link';
  url?: string;
}

const CASES: [string, Expect][] = [
  // Plan's named phrases
  ['dentist Tue 3pm', { when: { start: '2026-11-10 15:00', confident: true }, title: 'Dentist' }],
  ['brunch Saturday 11', { when: { start: '2026-11-07 11:00', confident: true }, title: 'Brunch' }],
  [
    'training Tues and Thurs 7pm',
    {
      when: { start: '2026-11-10 19:00', confident: true, rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' },
      title: 'Training',
    },
  ],
  [
    "John's birthday 14 March",
    {
      when: { start: '2027-03-14', allDay: true, confident: true, rrule: 'FREQ=YEARLY' },
      title: "John's birthday",
    },
  ],
  [
    'call Mark tomorrow',
    { when: { start: '2026-11-07', allDay: true, confident: false }, title: 'Call Mark' },
  ],
  ['sometime next week', { when: { start: '2026-11-13', allDay: true, confident: false } }],
  [
    '3/4 meeting',
    { when: { start: '2027-04-03', allDay: true, confident: false }, title: 'Meeting' },
  ],
  // Times and dates
  ['meeting 3/4 at 10', { when: { start: '2027-04-03 10:00', confident: true }, title: 'Meeting' }],
  [
    'concert 20/12 at 8pm',
    { when: { start: '2026-12-20 20:00', confident: true }, title: 'Concert' },
  ],
  [
    'party 12 December 9pm',
    { when: { start: '2026-12-12 21:00', confident: true }, title: 'Party' },
  ],
  [
    'Christmas dinner 25 Dec 3pm',
    { when: { start: '2026-12-25 15:00', confident: true }, title: 'Christmas dinner' },
  ],
  [
    'doctor at 10:30am Wednesday',
    { when: { start: '2026-11-11 10:30', confident: true }, title: 'Doctor' },
  ],
  [
    'flight 23:45 on Friday',
    { when: { start: '2026-11-06 23:45', confident: true }, title: 'Flight' },
  ],
  ['next Monday at noon', { when: { start: '2026-11-09 12:00', confident: true } }],
  ['dinner tonight 8pm', { when: { start: '2026-11-06 20:00', confident: true }, title: 'Dinner' }],
  [
    'lunch tomorrow at 1pm',
    { when: { start: '2026-11-07 13:00', confident: true }, title: 'Lunch' },
  ],
  [
    'visit on 1/2',
    { when: { start: '2027-02-01', allDay: true, confident: false }, title: 'Visit' },
  ],
  // All-day wording
  [
    'anniversary 2 June',
    { when: { start: '2027-06-02', allDay: true, confident: true, rrule: 'FREQ=YEARLY' } },
  ],
  [
    'holiday 14-18 July',
    {
      when: { start: '2027-07-14', end: '2027-07-18', allDay: true, confident: true },
      title: 'Holiday',
    },
  ],
  [
    'conference 3-5 March',
    { when: { start: '2027-03-03', end: '2027-03-05', allDay: true, confident: false } },
  ],
  // Fuzzy or missing parts
  ['dentist maybe Tue 3pm', { when: { start: '2026-11-10 15:00', confident: false } }],
  ['coffee Tue 3ish', { when: { start: '2026-11-10', allDay: true, confident: false } }],
  ['dinner at 8ish', { when: null }],
  ['lunch with Sam at 1pm', { when: { start: '2026-11-06 13:00', confident: false } }],
  ['probably drinks Friday 6pm', { when: { start: '2026-11-06 18:00', confident: false } }],
  ["yesterday's meeting notes", { when: { start: '2026-11-05', allDay: true, confident: false } }],
  ['buy milk', { when: null, title: 'Buy milk' }],
  // Recurrence
  [
    'gym every day 7am',
    { when: { start: '2026-11-07 07:00', confident: true, rrule: 'FREQ=DAILY' }, title: 'Gym' },
  ],
  [
    'standup every weekday 9:30',
    {
      when: {
        start: '2026-11-09 09:30',
        confident: true,
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      },
      title: 'Standup',
    },
  ],
  [
    'bins every Thursday',
    {
      when: { start: '2026-11-12', allDay: true, confident: false, rrule: 'FREQ=WEEKLY;BYDAY=TH' },
      title: 'Bins',
    },
  ],
  [
    'pay rent on the 1st every month',
    {
      when: {
        start: '2026-12-01',
        allDay: true,
        confident: false,
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
      },
      title: 'Pay rent',
    },
  ],
  [
    'team review every 2 weeks on Monday at 10am',
    {
      when: {
        start: '2026-11-09 10:00',
        confident: true,
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
      },
      title: 'Team review',
    },
  ],
  [
    'football fortnightly on Wednesdays at 8pm',
    {
      when: {
        start: '2026-11-11 20:00',
        confident: true,
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
      },
      title: 'Football',
    },
  ],
  [
    'swim Mondays 7am',
    {
      when: { start: '2026-11-09 07:00', confident: true, rrule: 'FREQ=WEEKLY;BYDAY=MO' },
      title: 'Swim',
    },
  ],
  // Links
  ['https://example.com/article', { kind: 'link', url: 'https://example.com/article', when: null }],
  [
    'read this https://example.com/x later',
    { kind: 'link', url: 'https://example.com/x', title: 'Read this later' },
  ],
];

describe('analyseCapture', () => {
  it('has at least 30 phrases', () => expect(CASES.length).toBeGreaterThanOrEqual(30));

  it.each(CASES)('%s', (text, expected) => {
    const result = analyseCapture(text, { now: NOW, timeZone: TZ });

    if (expected.kind) expect(result.kind).toBe(expected.kind);
    if (expected.url) expect(result.url).toBe(expected.url);
    if (expected.title) expect(result.title).toBe(expected.title);

    if (expected.when === null) {
      expect(result.when).toBeNull();
    } else if (expected.when) {
      const w = result.when;
      expect(w, 'expected a date').not.toBeNull();
      if (!w) return;
      const allDay = expected.when.allDay ?? false;
      expect(w.allDay).toBe(allDay);
      expect(local(w.start, allDay)).toBe(expected.when.start);
      if (expected.when.end) expect(local(w.end ?? '', allDay)).toBe(expected.when.end);
      expect(w.confident).toBe(expected.when.confident);
      expect(w.rrule).toBe(expected.when.rrule ?? null);
      if (w.rrule) expect(() => RRule.parseString(w.rrule ?? '')).not.toThrow();
    }
  });

  it('always reads d/m the British way', () => {
    const r = analyseCapture('4/3 dentist at 9am', { now: NOW, timeZone: TZ });
    expect(local(r.when?.start ?? '', false)).toBe('2027-03-04 09:00');
  });

  it('keeps the original text intact (it never edits captures)', () => {
    const text = 'dentist Tue 3pm';
    analyseCapture(text, { now: NOW, timeZone: TZ });
    expect(text).toBe('dentist Tue 3pm');
  });
});
