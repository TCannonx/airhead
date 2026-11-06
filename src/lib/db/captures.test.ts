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

  it('plain text creates no item yet (it waits for sorting)', async () => {
    await createCapture(db, USER, { text: 'buy milk' });
    expect(await db.items.count()).toBe(0);
  });
});
