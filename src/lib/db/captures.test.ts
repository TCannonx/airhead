import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapture, isSimpleCapture } from './captures';
import { undoInstantEvent } from './events';
import { openUserDb, type AirheadDb } from './db';

const USER = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${USER}-captures`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('createCapture + free rules', () => {
  it('a link anywhere in the text makes a link capture and a reading item', async () => {
    const { capture: c } = await createCapture(db, USER, {
      text: 'read this https://example.com/x later',
    });
    expect(c).toMatchObject({ kind: 'link', url: 'https://example.com/x' });
    // The free rules handled it: it doesn't wait in the Inbox.
    expect(c.status).toBe('sorted');
    // The original words are kept exactly as typed.
    expect(c.text).toBe('read this https://example.com/x later');

    const items = await db.items.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'reading',
      title: 'Read this later',
      capture_id: c.id,
      status: 'open',
      data: { url: 'https://example.com/x' },
    });
  });

  it('a bare link becomes a reading item titled with the link', async () => {
    const { capture: c } = await createCapture(db, USER, { url: 'https://example.com/article' });
    const [item] = await db.items.toArray();
    expect(item).toMatchObject({
      type: 'reading',
      title: 'https://example.com/article',
      capture_id: c.id,
    });
  });

  it.each([
    'dentist moved to Thursday 4pm',
    'remind me every 2 weeks to text the barber',
    'meeting rescheduled to Friday 10am',
    'off 22-24 Dec',
    'took Friday off',
    'I have 9.5 days annual leave left',
  ])('"%s" waits for AI sorting instead of becoming a new event', async (text) => {
    const { capture: c } = await createCapture(db, USER, { text });
    expect(c.status).toBe('unsorted');
    expect(await db.items.count()).toBe(0);
  });

  it('a plain dated note still becomes an event straight away', async () => {
    const { capture: c, event } = await createCapture(
      db,
      USER,
      {
        text: 'dentist Tue 3pm',
        // A fixed Friday, so "Tue 3pm" is in the future.
      },
      { now: new Date('2026-11-06T10:00:00Z') },
    );
    expect(event?.title).toBe('Dentist');
    expect(c.status).toBe('sorted');
  });

  it.each(['dentist Tue 3pm', 'Quiz every Thursday 8pm-12pm'])(
    '"%s" is simple: its instant event is all there is',
    (text) => expect(isSimpleCapture(text)).toBe(true),
  );

  it.each([
    'Training on Tuesday. Need a reminder to send report to Trevor',
    'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder',
    'dinner with Anna and Tom at the new place in town on Friday 8pm',
    'Gym Tuesday 7pm and then call mum',
  ])('"%s" is not simple', (text) => expect(isSimpleCapture(text)).toBe(false));

  it('a simple dated note keeps its time range and is done', async () => {
    const { capture: c, event } = await createCapture(
      db,
      USER,
      { text: 'Quiz every Thursday 8pm-12pm' },
      { now: new Date('2026-11-06T10:00:00Z') },
    );
    expect(c.status).toBe('sorted');
    expect(c.payload.instant_item_id).toBeUndefined();
    expect(event).toMatchObject({
      title: 'Quiz',
      start_at: '2026-11-12T20:00:00.000Z',
      end_at: '2026-11-13T00:00:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
    });
  });

  it('a longer dated note shows its event at once but still goes to sorting', async () => {
    const { capture: c, event } = await createCapture(
      db,
      USER,
      { text: 'Training on Tuesday. Need a reminder to send report to Trevor' },
      { now: new Date('2026-11-06T10:00:00Z') },
    );
    expect(event?.type).toBe('event');
    expect(event?.capture_id).toBe(c.id);
    expect(c.status).toBe('unsorted');
    expect(c.sorted_at).toBeNull();
    expect(c.payload.instant_item_id).toBe(event?.id);
    expect(await db.items.count()).toBe(1);
    expect((await db.captures.get(c.id))?.payload.instant_item_id).toBe(event?.id);
  });

  it('undoing the instant event of a longer note forgets it', async () => {
    const { capture: c, event } = await createCapture(
      db,
      USER,
      { text: 'Training on Tuesday. Need a reminder to send report to Trevor' },
      { now: new Date('2026-11-06T10:00:00Z') },
    );
    await undoInstantEvent(db, event?.id ?? '');
    const after = await db.captures.get(c.id);
    expect(after?.status).toBe('unsorted');
    expect(after?.payload.instant_item_id).toBeUndefined();
  });

  it('plain text creates no item yet (it waits for sorting)', async () => {
    await createCapture(db, USER, { text: 'buy milk' });
    expect(await db.items.count()).toBe(0);
  });
});
