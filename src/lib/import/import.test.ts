import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openUserDb, type AirheadDb } from '../db/db';
import { newItem } from '../db/repository';
import { DEFAULT_WORK_SETTINGS } from '../work/settings';
import { busyBetween, checkEvent } from './checks';
import { applyInstruction, ownTeam } from './filter';
import { isIcs, parseIcsImport } from './ics';
import { eventItem, localInstant, saveImport } from './save';
import { csvRows, guessMapping, parseDateCell, parseTimeCell, rowsToEvents } from './table';
import { proposed } from './types';

const TZ = 'Europe/Dublin';
const NOW = new Date('2027-01-10T10:00:00Z');
const U = '11111111-1111-4111-8111-111111111111';
const fixture = (name: string) => readFileSync(`tests/fixtures/import/${name}`, 'utf8');

describe('.ics import (exact, on the device)', () => {
  it('reads future events in local time; past and cancelled are left out', () => {
    const text = fixture('club.ics');
    expect(isIcs(text)).toBe(true);
    const { name, events } = parseIcsImport(text, NOW, TZ);
    expect(name).toBe('Club fixtures 2027');
    expect(events.map((e) => [e.title, e.date, e.start_time, e.end_time, e.venue])).toEqual([
      ["St Vincent's v Kilmacud Crokes", '2027-03-06', '19:00', '20:30', 'Marino'],
      ["Ballyboden v St Vincent's", '2027-03-14', '14:00', '15:30', 'Ballyboden'],
      ["St Vincent's v Na Fianna", '2027-03-20', null, null, 'Marino'],
    ]);
  });
});

describe('CSV import with column mapping', () => {
  const rows = csvRows(fixture('fixtures.csv'));

  it('guesses the columns from the header', () => {
    expect(guessMapping(rows[0] ?? [])).toEqual({ date: 0, title: 1, time: 2, venue: 3 });
  });

  it('turns rows into events: day-first dates, any time format, TBC as no time', () => {
    const events = rowsToEvents(rows.slice(1), guessMapping(rows[0] ?? []), NOW);
    expect(events.map((e) => [e.date, e.title, e.start_time, e.venue])).toEqual([
      ['2027-03-06', "St Vincent's v Kilmacud Crokes", '19:00', 'Marino'],
      ['2027-03-14', "Ballyboden v St Vincent's", '14:00', 'Ballyboden'],
      ['2027-03-20', "St Vincent's v Na Fianna", null, 'Marino'],
      ['2027-03-27', "Cuala v St Vincent's", '19:30', 'Dalkey'],
    ]);
  });

  it('builds titles from home and away columns', () => {
    const events = rowsToEvents(
      [['2027-04-03', 'Dublin', 'Kerry', '7pm']],
      { date: 0, home: 1, away: 2, time: 3 },
      NOW,
    );
    expect(events[0]).toMatchObject({ title: 'Dublin v Kerry', start_time: '19:00' });
  });

  it('parses cells', () => {
    expect(parseDateCell('3/4/2027', NOW)).toBe('2027-04-03');
    expect(parseDateCell('Sat 6 March', NOW)).toBe('2027-03-06');
    expect(parseDateCell('2027-05-01T00:00:00', NOW)).toBe('2027-05-01');
    expect(parseDateCell('', NOW)).toBeNull();
    expect(parseTimeCell('7.30pm')).toBe('19:30');
    expect(parseTimeCell('12am')).toBe('00:00');
    expect(parseTimeCell('1930')).toBe('19:30');
    expect(parseTimeCell('TBC')).toBeNull();
    expect(parseTimeCell('25:00')).toBeNull();
  });
});

describe('the instruction as a filter (code routes)', () => {
  const events = rowsToEvents(
    csvRows(fixture('fixtures.csv')).slice(1),
    { date: 0, title: 1, time: 2, venue: 3 },
    NOW,
  );

  it('finds the team the schedule is for', () => {
    expect(ownTeam(events)).toBe("st vincent's");
  });

  it('"only home games" keeps the team’s home fixtures', () => {
    const r = applyInstruction(events, 'only home games');
    expect(r.events.map((e) => e.date)).toEqual(['2027-03-06', '2027-03-20']);
    expect(r.applied).toBe("home games of St Vincent's");
  });

  it('away, weekends, a named team and "attending all"', () => {
    expect(applyInstruction(events, 'away games').events.map((e) => e.date)).toEqual([
      '2027-03-14',
      '2027-03-27',
    ]);
    // 6, 14, 20, 27 March 2027: Sat, Sun, Sat, Sat.
    expect(applyInstruction(events, 'weekdays only').events).toHaveLength(0);
    expect(applyInstruction(events, 'only cuala').events.map((e) => e.date)).toEqual([
      '2027-03-27',
    ]);
    expect(applyInstruction(events, 'attending all')).toEqual({ events, applied: null });
    expect(applyInstruction(events, '')).toEqual({ events, applied: null });
  });
});

describe('review checks', () => {
  const data = {
    items: [
      newItem(U, {
        type: 'event',
        title: 'Dinner with Aoife',
        start_at: localInstant('2027-03-06', '18:30', TZ),
        end_at: localInstant('2027-03-06', '21:00', TZ),
        calendar: 'personal',
      }),
    ],
    external: [],
    feeds: [],
    leave: [],
    workDays: [],
    work: DEFAULT_WORK_SETTINGS,
  };
  const busy = busyBetween(data, '2027-03-01', '2027-03-31', TZ);

  it('flags clashes with existing events', () => {
    expect(
      checkEvent(proposed({ title: 'Match', date: '2027-03-06', start_time: '19:00' }), busy, data)
        .clashes,
    ).toEqual(['Dinner with Aoife']);
    expect(
      checkEvent(proposed({ title: 'Match', date: '2027-03-06', start_time: '14:00' }), busy, data)
        .clashes,
    ).toEqual([]);
  });

  it('flags events on working days (to offer leave)', () => {
    expect(
      checkEvent(proposed({ title: 'Match', date: '2027-03-10', start_time: '14:00' }), busy, data)
        .workingDay,
    ).toBe(true);
    expect(
      checkEvent(proposed({ title: 'Match', date: '2027-03-06' }), busy, data).workingDay,
    ).toBe(false);
    expect(
      checkEvent(proposed({ title: 'Parade', date: '2027-03-17' }), busy, data).workingDay,
    ).toBe(false);
  });
});

describe('saving an import as a series', () => {
  let db: AirheadDb;
  beforeEach(async () => {
    db = openUserDb(`${U}-import`);
    await db.open();
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('local times become instants, also across the clock change', () => {
    expect(localInstant('2027-03-06', '19:00', TZ)).toBe('2027-03-06T19:00:00.000Z');
    expect(localInstant('2027-07-06', '19:00', TZ)).toBe('2027-07-06T18:00:00.000Z');
    expect(localInstant('2027-03-28', '12:00', TZ)).toBe('2027-03-28T11:00:00.000Z');
  });

  it('an unconfirmed time becomes an all-day "time TBC" event', () => {
    const item = eventItem(
      U,
      proposed({ title: 'Final', date: '2027-03-20', venue: 'Marino' }),
      { id: 's1', calendar: 'us' },
      TZ,
    );
    expect(item).toMatchObject({
      all_day: true,
      calendar: 'us',
      series_id: 's1',
      start_at: '2027-03-20T00:00:00.000Z',
      data: { location: 'Marino', time_tbc: true, source: 'import' },
    });
  });

  it('saves the ticked events with the series and keeps the original file', async () => {
    const events = [
      proposed({ title: 'A v B', date: '2027-03-06', start_time: '19:00', end_time: '20:30' }),
      proposed({ title: 'C v D', date: '2027-03-14', include: false }),
    ];
    const file = new Blob([fixture('fixtures.csv')], { type: 'text/csv' });
    const { series, items } = await saveImport(
      db,
      U,
      {
        name: 'Club 2027',
        calendar: 'us',
        events,
        file: { blob: file, name: 'Club fixtures 2027.csv' },
        instruction: 'only home games',
        route: 'csv',
      },
      TZ,
    );
    expect(series).toMatchObject({
      name: 'Club 2027',
      calendar: 'us',
      source_kind: 'import',
      data: { route: 'csv', instruction: 'only home games' },
    });
    expect(series.source_path).toBe(`${U}/series/${series.id}/Club_fixtures_2027.csv`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'A v B',
      start_at: '2027-03-06T19:00:00.000Z',
      end_at: '2027-03-06T20:30:00.000Z',
      series_id: series.id,
    });
    const [stored] = await db.files.toArray();
    expect(stored).toMatchObject({ path: series.source_path, mime: 'text/csv', uploaded: false });
  });
});
