import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from './captures';
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

  it('plain text creates no item yet (it waits for sorting)', async () => {
    await createCapture(db, USER, { text: 'buy milk' });
    expect(await db.items.count()).toBe(0);
  });
});
