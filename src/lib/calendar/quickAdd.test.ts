import { describe, expect, it } from 'vitest';
import { parseQuickAdd, type QuickEvent, quickDraftTimes, quickPreview } from './quickAdd';

// Monday 9 November 2026, 10:00 in Dublin (GMT in winter).
const now = new Date('2026-11-09T10:00:00Z');
const timeZone = 'Europe/Dublin';
const opts = { now, timeZone };
const must = (q: QuickEvent | null): QuickEvent => {
  if (!q) throw new Error('nothing parsed');
  return q;
};

describe('quick add (Task 11.4)', () => {
  it('"Quiz every Thursday 8pm-12pm": weekly, with its end', () => {
    const q = parseQuickAdd('Quiz every Thursday 8pm-12pm', opts);
    expect(q).toMatchObject({
      title: 'Quiz',
      start: '2026-11-12T20:00:00.000Z',
      end: '2026-11-13T00:00:00.000Z',
      allDay: false,
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      calendar: 'personal',
      dated: true,
    });
    expect(quickPreview(must(q), timeZone, now)).toEqual({
      title: 'Quiz',
      when: 'Thu 12 Nov 2026, 20:00–00:00',
      repeat: 'Every Thursday',
      calendar: 'Personal',
    });
  });

  it('"Dentist Fri 3pm": a one-off hour', () => {
    const q = parseQuickAdd('Dentist Fri 3pm', opts);
    expect(q).toMatchObject({
      title: 'Dentist',
      start: '2026-11-13T15:00:00.000Z',
      end: '2026-11-13T16:00:00.000Z',
      rrule: null,
    });
    expect(quickPreview(must(q), timeZone, now).when).toBe('Fri 13 Nov 2026, 15:00–16:00');
  });

  it('"Niamh\'s birthday 11/11 every year": all day, yearly', () => {
    const q = parseQuickAdd("Niamh's birthday 11/11 every year", opts);
    expect(q).toMatchObject({
      title: "Niamh's birthday",
      start: '2026-11-11T00:00:00.000Z',
      end: null,
      allDay: true,
      rrule: 'FREQ=YEARLY',
    });
    const p = quickPreview(must(q), timeZone, now);
    expect(p.when).toBe('Wed 11 Nov 2026 · All day');
    expect(p.repeat).toBe('Every year on 11 Nov');
    // The editor takes an exclusive all-day end.
    expect(quickDraftTimes(must(q), timeZone).end?.toISOString()).toBe('2026-11-12T00:00:00.000Z');
  });

  it('no date: the next hour today, or 09:00 on the chosen day', () => {
    expect(parseQuickAdd('Call mam', opts)).toMatchObject({
      title: 'Call mam',
      start: '2026-11-09T11:00:00.000Z',
      end: '2026-11-09T12:00:00.000Z',
      dated: false,
    });
    expect(parseQuickAdd('Call mam', { ...opts, day: '2026-11-20' })?.start).toBe(
      '2026-11-20T09:00:00.000Z',
    );
    expect(parseQuickAdd('   ', opts)).toBeNull();
  });
});
