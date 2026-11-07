import { describe, expect, it } from 'vitest';
import { parseLeave } from './parse';

const NOW = new Date('2026-06-10T09:00:00Z'); // Wednesday 10 June 2026
const TZ = 'Europe/Dublin';
const p = (text: string) => parseLeave(text, NOW, TZ);

describe('leave capture rule', () => {
  it.each([
    ['AL 14–18 July', '2026-07-14', '2026-07-18'],
    ['AL 14-18 July', '2026-07-14', '2026-07-18'],
    ['annual leave 14 to 18 July', '2026-07-14', '2026-07-18'],
    ['al 3rd-7th August', '2026-08-03', '2026-08-07'],
    ['Leave 22 Dec - 2 Jan', '2026-12-22', '2027-01-02'],
    ['day off Friday', '2026-06-12', '2026-06-12'],
    ['A/L 1 March', '2027-03-01', '2027-03-01'],
  ])('%s → %s to %s', (text, start, end) => {
    expect(p(text)).toMatchObject({ start_date: start, end_date: end, leave_type: 'annual' });
  });

  it('sick leave is its own type', () => {
    expect(p('sick 2-3 March')).toMatchObject({
      start_date: '2027-03-02',
      end_date: '2027-03-03',
      leave_type: 'sick',
    });
  });

  it('half days: morning off by default, afternoon when it says so', () => {
    expect(p('half day AL Friday')).toMatchObject({
      start_date: '2026-06-12',
      start_half: false,
      end_half: true,
    });
    expect(p('AL half day Friday afternoon')).toMatchObject({ start_half: true, end_half: false });
  });

  it('ignores captures that are not leave', () => {
    expect(p('buy leaves for the garden')).toBeNull();
    expect(p('Dentist 14 July')).toBeNull();
    expect(p('AL')).toBeNull();
    expect(p('leave at 3pm tomorrow')).toBeNull();
    expect(p('Leave for the airport Friday')).toBeNull();
  });
});
