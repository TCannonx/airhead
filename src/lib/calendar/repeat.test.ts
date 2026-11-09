import { describe, expect, it } from 'vitest';
import { buildRepeat, formCanEdit, readRepeat, repeatWords } from './repeat';

describe('repeat in words', () => {
  const today = '2026-11-09';
  it('words common rules in plain British English', () => {
    expect(repeatWords('FREQ=DAILY', null, today)).toBe('Every day');
    expect(repeatWords('FREQ=DAILY;INTERVAL=3', null, today)).toBe('Every 3 days');
    expect(repeatWords('FREQ=WEEKLY;BYDAY=TH', null, today)).toBe('Every Thursday');
    expect(repeatWords('FREQ=WEEKLY', '2026-11-12', today)).toBe('Every Thursday');
    expect(repeatWords('FREQ=WEEKLY', null, today)).toBe('Every week');
    expect(repeatWords('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', null, today)).toBe(
      'Every 2 weeks on Mon and Thu',
    );
    expect(repeatWords('FREQ=WEEKLY;BYDAY=MO,WE,FR', null, today)).toBe('Every Mon, Wed and Fri');
    expect(repeatWords('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', null, today)).toBe('Every weekday');
    expect(repeatWords('FREQ=MONTHLY;BYMONTHDAY=1', null, today)).toBe('Every month on the 1st');
    expect(repeatWords('FREQ=MONTHLY', '2026-11-22', today)).toBe('Every month on the 22nd');
    expect(repeatWords('FREQ=MONTHLY;INTERVAL=2', '2026-11-13', today)).toBe(
      'Every 2 months on the 13th',
    );
    expect(repeatWords('RRULE:FREQ=YEARLY', '2026-11-11', today)).toBe('Every year on 11 Nov');
    expect(repeatWords('FREQ=YEARLY', null, today)).toBe('Every year');
  });

  it('says when it ends', () => {
    expect(repeatWords('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231T235959Z', null, today)).toBe(
      'Every Thursday until 31 Dec',
    );
    expect(repeatWords('FREQ=WEEKLY;BYDAY=TH;UNTIL=20270131T235959Z', null, today)).toBe(
      'Every Thursday until 31 Jan 2027',
    );
    expect(repeatWords('FREQ=DAILY;COUNT=5', null, today)).toBe('Every day, 5 times');
  });

  it("falls back to rrule's English for rules it cannot word", () => {
    expect(repeatWords('FREQ=MONTHLY;BYDAY=1MO', null, today)).toBe(
      'Every month on the 1st Monday',
    );
    expect(repeatWords('junk', null, today)).toBe('Junk');
  });
});

describe('repeat form', () => {
  it('reads a rule into the form and builds it back', () => {
    const f = readRepeat('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,MO;UNTIL=20261231T235959Z', '2026-11-12');
    expect(f).toMatchObject({
      freq: 'WEEKLY',
      interval: 2,
      byDay: ['TH', 'MO'],
      ends: 'on',
      until: '2026-12-31',
    });
    expect(buildRepeat(f)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261231T235959Z');
  });

  it('a weekly rule without days shows the start day; none, count and kept parts', () => {
    expect(readRepeat('FREQ=WEEKLY', '2026-11-12').byDay).toEqual(['TH']);
    expect(buildRepeat(readRepeat(null))).toBeNull();
    const monthly = readRepeat('FREQ=MONTHLY;BYMONTHDAY=1;COUNT=6');
    expect(monthly).toMatchObject({ ends: 'after', count: 6, extra: ['BYMONTHDAY=1'] });
    expect(buildRepeat(monthly)).toBe('FREQ=MONTHLY;BYMONTHDAY=1;COUNT=6');
    expect(buildRepeat({ ...monthly, freq: 'YEARLY', ends: 'never' })).toBe(
      'FREQ=YEARLY;BYMONTHDAY=1',
    );
  });

  it('knows which rules it can edit', () => {
    expect(formCanEdit(null)).toBe(true);
    expect(formCanEdit('FREQ=YEARLY')).toBe(true);
    expect(formCanEdit('FREQ=HOURLY')).toBe(false);
  });
});
