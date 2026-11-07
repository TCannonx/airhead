import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW, fitTasks, freeGaps, slotText, toHHMM, toMinutes } from './slots';

const span = (a: string, b: string) => ({ start: toMinutes(a), end: toMinutes(b) });
const text = (gaps: { start: number; end: number }[]) => gaps.map(slotText);
const W = DEFAULT_WINDOW.working; // 08:00–21:00

describe('free slots (Task 5.3)', () => {
  it('converts times', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toHHMM(570)).toBe('09:30');
    expect(() => toMinutes('9:30')).toThrow();
  });

  it('finds the gaps around events, with a 5-minute buffer, on quarter hours', () => {
    const busy = [span('09:00', '10:00'), span('12:00', '12:30'), span('15:00', '17:00')];
    expect(text(freeGaps(busy, W))).toEqual([
      '08:00–08:55',
      '10:15–11:55',
      '12:45–14:55',
      '17:15–21:00',
    ]);
  });

  it('merges overlapping events and drops gaps that are too short', () => {
    const busy = [span('09:00', '10:00'), span('09:30', '11:00'), span('11:10', '12:00')];
    expect(text(freeGaps(busy, W))).toEqual(['08:00–08:55', '12:15–21:00']);
  });

  it('starts from now, and events outside the window are ignored', () => {
    const busy = [span('06:00', '07:00'), span('22:00', '23:00')];
    expect(text(freeGaps(busy, W, toMinutes('13:07')))).toEqual(['13:15–21:00']);
  });

  it('a day full of events has no room', () => {
    expect(freeGaps([span('07:00', '22:00')], W)).toEqual([]);
  });

  it('fits tasks in order into the earliest gap that is long enough', () => {
    const gaps = freeGaps([span('09:00', '12:20'), span('12:50', '17:00')], W);
    expect(text(gaps)).toEqual(['08:00–08:55', '12:30–12:45', '17:15–21:00']);
    const slots = fitTasks(
      [
        { id: 'call', minutes: 15 },
        { id: 'report', minutes: 90 },
        { id: 'email', minutes: 10 },
      ],
      gaps,
    );
    expect(Object.fromEntries([...slots].map(([k, v]) => [k, v && slotText(v)]))).toEqual({
      call: '08:00–08:15',
      report: '17:15–18:45',
      email: '08:30–08:45', // 10 minutes rounds up to the 15-minute minimum
    });
  });

  it('a task that fits nowhere gets no slot; estimates are capped at two hours', () => {
    const gaps = freeGaps([span('08:00', '20:00')], W);
    const slots = fitTasks(
      [
        { id: 'big', minutes: 300 },
        { id: 'small', minutes: 30 },
      ],
      gaps,
    );
    expect(slots.get('big')).toBeNull();
    expect(slots.get('small') && slotText(slots.get('small') ?? { start: 0, end: 0 })).toBe(
      '20:15–20:45',
    );
  });

  it('wall-clock minutes need nothing special on the clock-change day', () => {
    // 25 October 2026: the clocks go back at 02:00, but the day's wall times are as usual.
    expect(text(freeGaps([span('10:00', '11:00')], W))).toEqual(['08:00–09:55', '11:15–21:00']);
  });
});
