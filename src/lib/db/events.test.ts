import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from './captures';
import { openUserDb, type AirheadDb } from './db';
import { acceptSuggestion, dismissSuggestion, eventLabel, undoInstantEvent } from './events';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-06T10:00:00Z'); // Friday 10:00 Dublin
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${USER}-events`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('instant events', () => {
  it('a confident date creates a Personal event at once and marks the capture sorted', async () => {
    const { capture, event } = await createCapture(
      db,
      USER,
      { text: 'dentist Tue 3pm' },
      { now: NOW },
    );
    expect(event).toMatchObject({
      type: 'event',
      status: 'open',
      title: 'Dentist',
      calendar: 'personal',
      start_at: '2026-11-10T15:00:00.000Z',
      all_day: false,
      capture_id: capture.id,
    });
    expect(capture.status).toBe('sorted');
    expect(capture.sorted_at).not.toBeNull();
    expect(await db.items.count()).toBe(1);
  });

  it('keeps recurrence and all-day details', async () => {
    const { event } = await createCapture(
      db,
      USER,
      { text: "John's birthday 14 March" },
      { now: NOW },
    );
    expect(event).toMatchObject({ all_day: true, rrule: 'FREQ=YEARLY', status: 'open' });
  });

  it('a fuzzy date becomes a suggestion and the capture waits for a tap', async () => {
    const { capture, event } = await createCapture(
      db,
      USER,
      { text: 'call Mark tomorrow' },
      { now: NOW },
    );
    expect(event).toMatchObject({
      type: 'event',
      status: 'suggested',
      title: 'Call Mark',
      all_day: true,
    });
    expect(capture.status).toBe('needs_review');
  });

  it('no date: no event, capture stays unsorted', async () => {
    const { capture, event } = await createCapture(db, USER, { text: 'buy milk' }, { now: NOW });
    expect(event).toBeNull();
    expect(capture.status).toBe('unsorted');
  });

  it('undo removes the event (recoverable) and hands the capture back to sorting', async () => {
    const { capture, event } = await createCapture(
      db,
      USER,
      { text: 'dentist Tue 3pm' },
      { now: NOW },
    );
    await undoInstantEvent(db, event?.id ?? '');
    expect((await db.items.get(event?.id ?? ''))?.deleted_at).not.toBeNull();
    expect((await db.captures.get(capture.id))?.status).toBe('unsorted');
  });

  it('accepting a suggestion puts it on the calendar; dismissing drops it', async () => {
    const a = await createCapture(db, USER, { text: 'call Mark tomorrow' }, { now: NOW });
    await acceptSuggestion(db, a.event?.id ?? '');
    expect((await db.items.get(a.event?.id ?? ''))?.status).toBe('open');
    expect((await db.captures.get(a.capture.id))?.status).toBe('sorted');

    const b = await createCapture(db, USER, { text: 'sometime next week' }, { now: NOW });
    await dismissSuggestion(db, b.event?.id ?? '');
    expect((await db.items.get(b.event?.id ?? ''))?.status).toBe('dropped');
    expect((await db.captures.get(b.capture.id))?.status).toBe('sorted');
  });
});

describe('eventLabel', () => {
  it('uses the weekday within the next week, the date beyond it', () => {
    expect(eventLabel({ start_at: '2026-11-07T11:00:00.000Z', all_day: false }, NOW)).toBe(
      'Sat 11:00',
    );
    expect(eventLabel({ start_at: '2026-12-20T20:00:00.000Z', all_day: false }, NOW)).toBe(
      'Sun 20 Dec, 20:00',
    );
    expect(eventLabel({ start_at: '2027-03-14T00:00:00.000Z', all_day: true }, NOW)).toBe(
      'Sun 14 Mar',
    );
  });
});
