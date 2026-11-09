import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureSchema, itemSchema } from '../schemas/records';
import { openUserDb, type AirheadDb } from './db';
import {
  baseRecord,
  newCapture,
  newItem,
  requestPersistentStorage,
  restore,
  save,
  softDelete,
} from './repository';

const USER = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(USER);
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('local database', () => {
  it('has every synced table plus outbox, sync_state and meta', () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      [
        'ai_actions',
        'captures',
        'corrections',
        'devices',
        'files',
        'follow_ups',
        'items',
        'learned_rules',
        'lists',
        'memory_facts',
        'meta',
        'outbox',
        'settings',
        'sync_state',
        'topics',
        'series',
        'feeds',
        'external_events',
        'work_days',
        'leave_bookings',
        'briefs',
        'note_docs',
        'drafts',
        'workshop_sessions',
        'reviews',
        'scout_runs',
        'suggestions',
      ].sort(),
    );
  });

  it('keeps one database per user', () => {
    expect(db.name).toBe(`airhead-${USER}`);
    expect(openUserDb('22222222-2222-4222-8222-222222222222').name).not.toBe(db.name);
  });
});

describe('save', () => {
  it('writes the row and an outbox entry together', async () => {
    const capture = newCapture(USER, { text: 'dentist tue 3pm' });
    await save(db, 'captures', capture);

    const stored = await db.captures.get(capture.id);
    expect(stored?.text).toBe('dentist tue 3pm');
    expect(stored?.server_updated_at).toBeNull();
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ table: 'captures', row_id: capture.id });
  });

  it('bumps updated_at on every save and queues each change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'));
    const item = newItem(USER, { type: 'task', title: 'Call Mark' });
    await save(db, 'items', item);
    vi.setSystemTime(new Date('2026-11-06T10:05:00Z'));
    await save(db, 'items', { ...item, title: 'Call Mark back' });
    vi.useRealTimers();

    const stored = await db.items.get(item.id);
    expect(stored?.title).toBe('Call Mark back');
    expect(stored?.updated_at).toBe('2026-11-06T10:05:00.000Z');
    expect(stored?.created_at).toBe('2026-11-06T10:00:00.000Z');
    expect(await db.outbox.count()).toBe(2);
  });

  it('rejects an invalid row and writes nothing', async () => {
    const bad = { ...newItem(USER, { type: 'task', title: 'x' }), type: 'banana' };
    // @ts-expect-error deliberately invalid
    await expect(save(db, 'items', bad)).rejects.toThrow();
    expect(await db.items.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('soft delete and restore', () => {
  it('marks deleted_at, keeps the row, and queues both changes', async () => {
    const item = newItem(USER, { type: 'note', title: 'keep me' });
    await save(db, 'items', item);
    await softDelete(db, 'items', item.id);
    expect((await db.items.get(item.id))?.deleted_at).not.toBeNull();

    await restore(db, 'items', item.id);
    expect((await db.items.get(item.id))?.deleted_at).toBeNull();
    expect(await db.outbox.count()).toBe(3);
  });

  it('does nothing for an unknown id', async () => {
    await softDelete(db, 'items', '33333333-3333-4333-8333-333333333333');
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('schemas', () => {
  it('accept rows exactly as the server returns them', () => {
    const serverRow = {
      ...baseRecord(USER),
      server_updated_at: '2026-11-06T10:00:00.123456+00:00',
      created_at: '2026-11-06T10:00:00+00:00',
      updated_at: '2026-11-06T10:00:00+00:00',
      kind: 'link',
      text: null,
      url: 'https://example.com',
      payload: {},
      source: 'app',
      status: 'unsorted',
      captured_at: '2026-11-06T10:00:00+00:00',
      sorted_at: null,
    };
    expect(captureSchema.parse(serverRow).url).toBe('https://example.com');
  });

  it('reject unknown item types and confidence outside 0-1', () => {
    const item = newItem(USER, { type: 'task', title: 't' });
    expect(itemSchema.safeParse({ ...item, type: 'banana' }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, confidence: 1.5 }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, confidence: 0.7 }).success).toBe(true);
  });
});

describe('requestPersistentStorage', () => {
  it('asks the browser once and remembers the answer', async () => {
    const persist = vi.fn(async () => true);
    const storage = { persist, persisted: vi.fn(async () => false) };
    expect(await requestPersistentStorage(db, storage)).toBe(true);
    expect(await requestPersistentStorage(db, storage)).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('copes with browsers that have no storage manager', async () => {
    expect(await requestPersistentStorage(db, undefined)).toBe(false);
  });
});
