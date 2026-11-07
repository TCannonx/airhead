import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openUserDb, type AirheadDb } from './db';
import {
  addEntry,
  clearCompleted,
  createList,
  createListFromSuggestion,
  defaultListId,
  ensureDefaultList,
  listEntries,
  moveList,
  renameList,
  toggleEntry,
} from './lists';
import { newItem, save } from './repository';

const U = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${U}-lists`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('lists', () => {
  it('the default Shopping list has the same id on every device and is created once', async () => {
    expect(defaultListId(U)).toBe(defaultListId(U));
    expect(defaultListId(U)).toMatch(/^[0-9a-f-]{36}$/);
    await ensureDefaultList(db, U);
    await ensureDefaultList(db, U);
    const lists = await db.lists.toArray();
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ id: defaultListId(U), name: 'Shopping' });
  });

  it('adds, ticks off and clears entries', async () => {
    const shop = await ensureDefaultList(db, U);
    const milk = await addEntry(db, U, shop.id, 'Milk');
    await addEntry(db, U, shop.id, 'Bin bags');
    expect(milk).toMatchObject({ type: 'list_entry', list_id: shop.id, status: 'open' });

    await toggleEntry(db, milk.id);
    expect((await db.items.get(milk.id))?.status).toBe('done');
    expect((await db.items.get(milk.id))?.completed_at).not.toBeNull();
    await toggleEntry(db, milk.id);
    expect((await db.items.get(milk.id))?.status).toBe('open');

    await toggleEntry(db, milk.id);
    await clearCompleted(db, shop.id);
    const left = listEntries(await db.items.toArray(), shop.id);
    expect(left.map((e) => e.title)).toEqual(['Bin bags']);
    expect((await db.items.get(milk.id))?.deleted_at).not.toBeNull(); // recoverable from Trash
  });

  it('creates, renames and reorders lists', async () => {
    await ensureDefaultList(db, U);
    const packing = await createList(db, U, 'Packing');
    const films = await createList(db, U, 'Films to watch');
    await renameList(db, films.id, 'Films');
    await moveList(db, U, films.id, -1);
    const names = (await db.lists.orderBy('sort_order').toArray()).map((l) => l.name);
    expect(names).toEqual(['Shopping', 'Films', 'Packing']);
    expect(packing.id).toBeTruthy();
  });

  it('"Create list" from a sorting suggestion files every waiting entry for that list', async () => {
    const a = await save(
      db,
      'items',
      newItem(U, {
        type: 'list_entry',
        title: 'Passport',
        status: 'suggested',
        data: { proposed_list: 'Packing' },
      }),
    );
    const b = await save(
      db,
      'items',
      newItem(U, {
        type: 'list_entry',
        title: 'Charger',
        status: 'suggested',
        data: { proposed_list: 'packing' },
      }),
    );
    const list = await createListFromSuggestion(db, U, a.id);

    expect(list?.name).toBe('Packing');
    for (const id of [a.id, b.id]) {
      const item = await db.items.get(id);
      expect(item).toMatchObject({ list_id: list?.id, status: 'open' });
      expect(item?.data.proposed_list).toBeUndefined();
    }
  });

  it('"Create list" reuses a list that now exists with that name', async () => {
    const existing = await createList(db, U, 'Packing');
    const a = await save(
      db,
      'items',
      newItem(U, {
        type: 'list_entry',
        title: 'Socks',
        status: 'suggested',
        data: { proposed_list: 'PACKING' },
      }),
    );
    const list = await createListFromSuggestion(db, U, a.id);
    expect(list?.id).toBe(existing.id);
    expect(await db.lists.count()).toBe(1);
  });
});
