import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from './captures';
import { openUserDb, type AirheadDb } from './db';
import { baseRecord, newItem, save, softDelete } from './repository';
import { changeItemType, filterLibrary, sortCaptureAs, trashItems, TRASH_DAYS } from './sorting';

const USER = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${USER}-sorting`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('manual sorting', () => {
  it('sorting an unsorted capture creates the item, marks it sorted and records a correction', async () => {
    const { capture } = await createCapture(db, USER, { text: 'ring the plumber' });
    const item = await sortCaptureAs(db, USER, capture.id, 'task');

    expect(item).toMatchObject({ type: 'task', title: 'Ring the plumber', capture_id: capture.id });
    expect((await db.captures.get(capture.id))?.status).toBe('sorted');
    const [c] = await db.corrections.toArray();
    expect(c).toMatchObject({
      capture_id: capture.id,
      from_value: { status: 'unsorted' },
      to_value: { type: 'task' },
    });
  });

  it('changing an item type records the correction and keeps everything else', async () => {
    const item = await save(
      db,
      'items',
      newItem(USER, { type: 'note', title: 'Garden plan', capture_id: null }),
    );
    const changed = await changeItemType(db, USER, item.id, 'idea');
    expect(changed).toMatchObject({ type: 'idea', title: 'Garden plan' });
    const [c] = await db.corrections.toArray();
    expect(c).toMatchObject({ from_value: { type: 'note' }, to_value: { type: 'idea' } });
  });

  it('changing to the same type records nothing', async () => {
    const item = await save(db, 'items', newItem(USER, { type: 'note', title: 'x' }));
    await changeItemType(db, USER, item.id, 'note');
    expect(await db.corrections.count()).toBe(0);
  });
});

describe('library filters', () => {
  it('filters by type, topic and date, and hides deleted and dropped items', async () => {
    const topic = await save(db, 'topics', { ...baseRecord(USER), name: 'Garden' });
    const a = await save(
      db,
      'items',
      newItem(USER, { type: 'idea', title: 'Raised beds', topic_ids: [topic.id] }),
    );
    await save(db, 'items', newItem(USER, { type: 'idea', title: 'App idea' }));
    await save(
      db,
      'items',
      newItem(USER, { type: 'note', title: 'Shed notes', topic_ids: [topic.id] }),
    );
    const gone = await save(db, 'items', newItem(USER, { type: 'idea', title: 'Binned' }));
    await softDelete(db, 'items', gone.id);
    await save(db, 'items', newItem(USER, { type: 'idea', title: 'Dropped', status: 'dropped' }));

    const all = await db.items.toArray();
    expect(
      filterLibrary(all, { type: 'idea' })
        .map((i) => i.title)
        .sort(),
    ).toEqual(['App idea', 'Raised beds']);
    expect(
      filterLibrary(all, { topicId: topic.id })
        .map((i) => i.title)
        .sort(),
    ).toEqual(['Raised beds', 'Shed notes']);
    expect(filterLibrary(all, { type: 'idea', topicId: topic.id }).map((i) => i.id)).toEqual([
      a.id,
    ]);
    const today = new Date().toISOString().slice(0, 10);
    expect(filterLibrary(all, { from: today, to: today })).toHaveLength(3);
    expect(filterLibrary(all, { from: '2000-01-01', to: '2000-01-02' })).toHaveLength(0);
  });
});

describe('trash', () => {
  it('lists items deleted in the last 30 days, newest first', async () => {
    expect(TRASH_DAYS).toBe(30);
    const now = Date.now();
    const recent = await save(
      db,
      'items',
      newItem(USER, {
        type: 'note',
        title: 'recent',
        deleted_at: new Date(now - 86_400_000).toISOString(),
      }),
    );
    await save(
      db,
      'items',
      newItem(USER, {
        type: 'note',
        title: 'old',
        deleted_at: new Date(now - 31 * 86_400_000).toISOString(),
      }),
    );
    await save(db, 'items', newItem(USER, { type: 'note', title: 'live' }));
    const trash = trashItems(await db.items.toArray(), new Date(now));
    expect(trash.map((i) => i.id)).toEqual([recent.id]);
  });
});
