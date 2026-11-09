import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openUserDb, type AirheadDb } from '../db/db';
import { newItem, save, softDelete } from '../db/repository';
import { SYNC_TABLES } from '../schemas/records';
import { PULL_OVERLAP_MS, pull, push, SyncEngine } from './engine';
import { createFakeRemote } from './fakeRemote';
import { readSyncLog, resetSyncLog } from './syncLog';

const USER = '11111111-1111-4111-8111-111111111111';
let dbs: AirheadDb[] = [];

function device(name: string) {
  const db = openUserDb(`${USER}-${name}`);
  dbs.push(db);
  return db;
}

beforeEach(() => {
  dbs = [];
});

afterEach(async () => {
  vi.useRealTimers();
  for (const db of dbs) {
    db.close();
    await db.delete();
  }
});

describe('push', () => {
  it('sends queued rows and clears the outbox', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    const item = await save(db, 'items', newItem(USER, { type: 'task', title: 'Call Mark' }));

    await push(db, remote);

    expect(remote.rows('items').map((r) => r.title)).toEqual(['Call Mark']);
    expect(remote.rows('items')[0]?.id).toBe(item.id);
    expect(await db.outbox.count()).toBe(0);
  });

  it('sends several edits of one row once, with the latest state', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    const item = await save(db, 'items', newItem(USER, { type: 'task', title: 'v1' }));
    await save(db, 'items', { ...item, title: 'v2' });
    await save(db, 'items', { ...item, title: 'v3' });

    await push(db, remote);

    expect(remote.state.upsertCalls).toEqual([{ table: 'items', ids: [item.id] }]);
    expect(remote.rows('items')[0]?.title).toBe('v3');
  });

  it('upserts in batches of 100', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    for (let i = 0; i < 250; i++) {
      await save(db, 'items', newItem(USER, { type: 'note', title: `n${i}` }));
    }
    await push(db, remote);
    expect(remote.state.upsertCalls.map((c) => c.ids.length)).toEqual([100, 100, 50]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps the outbox when the network fails', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    remote.state.online = false;
    await save(db, 'items', newItem(USER, { type: 'task', title: 'offline' }));

    await expect(push(db, remote)).rejects.toThrow('Failed to fetch');
    expect(await db.outbox.count()).toBe(1);

    remote.state.online = true;
    await push(db, remote);
    expect(await db.outbox.count()).toBe(0);
    expect(remote.rows('items')).toHaveLength(1);
  });

  it('keeps changes made while a push is in flight', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    const item = await save(db, 'items', newItem(USER, { type: 'task', title: 'first' }));
    remote.onBeforeUpsert(async () => {
      remote.onBeforeUpsert(null);
      await save(db, 'items', { ...item, title: 'edited mid-push' });
    });

    await push(db, remote);

    expect(await db.outbox.count()).toBe(1);
    await push(db, remote);
    expect(remote.rows('items')[0]?.title).toBe('edited mid-push');
  });
});

describe('pull', () => {
  it('applies server rows in pages of 500 and advances the cursor', async () => {
    const db = device('b');
    const remote = createFakeRemote();
    for (let i = 0; i < 1200; i++) {
      remote.serverWrite('items', { ...newItem(USER, { type: 'note', title: `s${i}` }) });
    }
    const spy = vi.spyOn(remote, 'pullPage');

    await pull(db, remote);

    expect(await db.items.count()).toBe(1200);
    expect(spy.mock.calls.filter(([t]) => t === 'items')).toHaveLength(3);
    const state = await db.sync_state.get('items');
    expect(state?.cursor).toBe(remote.rows('items').at(-1)?.server_updated_at);
  });

  it('only fetches what changed since last time (with a small overlap)', async () => {
    const db = device('b');
    const remote = createFakeRemote();
    remote.serverWrite('items', newItem(USER, { type: 'note', title: 'old' }));
    await pull(db, remote);
    remote.tick(10 * 60_000);
    remote.serverWrite('items', newItem(USER, { type: 'note', title: 'new' }));
    const spy = vi.spyOn(remote, 'pullPage');

    await pull(db, remote);

    const after = spy.mock.calls.find(([t]) => t === 'items')?.[1];
    const cursor = Date.parse(String(remote.rows('items')[0]?.server_updated_at));
    expect(Date.parse(after?.ts ?? '')).toBe(cursor - PULL_OVERLAP_MS);
    expect(await db.items.count()).toBe(2);
  });

  it('picks up a row whose server time is just before the cursor (late commit)', async () => {
    const db = device('b');
    const remote = createFakeRemote();
    remote.serverWrite('items', newItem(USER, { type: 'note', title: 'first' }));
    await pull(db, remote);
    const cursor = Date.parse(String(remote.rows('items')[0]?.server_updated_at));
    // A slower transaction commits now, stamped 10 s before the cursor.
    remote.serverWrite('items', newItem(USER, { type: 'note', title: 'late' }), cursor - 10_000);

    await pull(db, remote);

    expect((await db.items.toArray()).map((i) => i.title).sort()).toEqual(['first', 'late']);
  });

  it('never overwrites a local row that has unpushed changes', async () => {
    const db = device('b');
    const remote = createFakeRemote();
    const item = newItem(USER, { type: 'task', title: 'server version' });
    remote.serverWrite('items', item);
    await save(db, 'items', { ...item, title: 'my offline edit' });

    await pull(db, remote);

    expect((await db.items.get(item.id))?.title).toBe('my offline edit');
  });

  it('applies deletions from other devices', async () => {
    const db = device('b');
    const remote = createFakeRemote();
    const item = newItem(USER, { type: 'task', title: 'bin me' });
    remote.serverWrite('items', item);
    await pull(db, remote);
    remote.serverWrite('items', { ...item, deleted_at: '2026-11-06T12:00:00.000Z' });

    await pull(db, remote);

    expect((await db.items.get(item.id))?.deleted_at).toBe('2026-11-06T12:00:00.000Z');
  });

  it('pulls every synced table', async () => {
    const db = device('b');
    const remote = createFakeRemote();
    const spy = vi.spyOn(remote, 'pullPage');
    await pull(db, remote);
    expect(new Set(spy.mock.calls.map(([t]) => t))).toEqual(new Set(SYNC_TABLES));
  });
});

describe('two devices', () => {
  it('a capture made offline on A appears on B after A reconnects', async () => {
    const remote = createFakeRemote();
    const a = device('a');
    const b = device('b');
    remote.state.online = false;
    const item = await save(a, 'items', newItem(USER, { type: 'task', title: 'Dentist Tue 3pm' }));
    await expect(push(a, remote)).rejects.toThrow();

    remote.state.online = true;
    await push(a, remote);
    await pull(b, remote);
    expect((await b.items.get(item.id))?.title).toBe('Dentist Tue 3pm');

    await softDelete(b, 'items', item.id);
    await push(b, remote);
    await pull(a, remote);
    expect((await a.items.get(item.id))?.deleted_at).not.toBeNull();
  });
});

describe('SyncEngine', () => {
  it('pushes then pulls, records the last sync and reports status', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    const engine = new SyncEngine(db, remote, { online: () => true });
    const states: string[] = [];
    engine.subscribe((s) => states.push(s.state));
    await save(db, 'items', newItem(USER, { type: 'task', title: 'x' }));

    await engine.syncNow();

    expect(remote.rows('items')).toHaveLength(1);
    expect(engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
    expect(engine.getStatus().lastSyncedAt).not.toBeNull();
    expect(states).toContain('syncing');
    expect((await db.meta.get('lastSyncedAt'))?.value).toBe(engine.getStatus().lastSyncedAt);
  });

  it('runs one sync at a time and folds overlapping requests into one more run', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    const engine = new SyncEngine(db, remote, { online: () => true });
    const spy = vi.spyOn(remote, 'pullPage');

    await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()]);

    // First run + one follow-up run, each pulling every table once.
    expect(spy.mock.calls.length).toBe(SYNC_TABLES.length * 2);
  });

  it('reports offline with the number waiting, and keeps the changes', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    remote.state.online = false;
    const engine = new SyncEngine(db, remote, { online: () => false });
    await save(db, 'items', newItem(USER, { type: 'task', title: 'a' }));
    await save(db, 'items', newItem(USER, { type: 'task', title: 'b' }));

    await engine.syncNow();

    expect(engine.getStatus()).toMatchObject({ state: 'offline', pending: 2 });
  });

  it('reports a plain error (not offline) when online but the server fails', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    vi.spyOn(remote, 'upsert').mockRejectedValue(new Error('boom'));
    const engine = new SyncEngine(db, remote, { online: () => true });
    await save(db, 'items', newItem(USER, { type: 'task', title: 'a' }));

    await engine.syncNow();

    expect(engine.getStatus().state).toBe('error');
    expect(engine.getStatus().message).toMatch(/will retry/i);
    expect(engine.getStatus().detail).toBe('boom');
  });

  it('a step that never finishes is abandoned, named, and the next run works', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    const realUpsert = remote.upsert.bind(remote);
    const hang = vi.spyOn(remote, 'upsert').mockImplementationOnce(() => new Promise(() => {}));
    const engine = new SyncEngine(db, remote, { online: () => true, runLimitMs: 50 });
    await save(db, 'items', newItem(USER, { type: 'task', title: 'a' }));

    await engine.syncNow();
    expect(engine.getStatus().state).toBe('error');
    expect(engine.getStatus().detail).toBe('Sync stopped responding while sending items.');

    hang.mockImplementation(realUpsert);
    await engine.syncNow();
    expect(engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('any trigger abandons a run far past its time limit, even if its watchdog never fired', async () => {
    resetSyncLog();
    const db = device('a');
    const remote = createFakeRemote();
    const realUpsert = remote.upsert.bind(remote);
    const hang = vi.spyOn(remote, 'upsert').mockImplementationOnce(() => new Promise(() => {}));
    // The watchdog is set far out (as if its timer never ran); a plain trigger must still recover.
    const engine = new SyncEngine(db, remote, {
      online: () => true,
      runLimitMs: 600_000,
      staleAfterMs: 30,
    });
    await save(db, 'items', newItem(USER, { type: 'task', title: 'a' }));

    const stuck = engine.syncNow();
    await vi.waitFor(() => expect(engine.getStatus().stage).toBe('sending items'));
    await new Promise((r) => setTimeout(r, 40));

    hang.mockImplementation(realUpsert);
    const fresh = engine.syncNow(); // a plain trigger, e.g. the minute timer
    expect(fresh).not.toBe(stuck);
    await fresh;
    expect(engine.getStatus()).toMatchObject({ state: 'idle', pending: 0, stage: undefined });
    expect(remote.rows('items').map((r) => r.title)).toEqual(['a']);
    expect(readSyncLog().map((x) => x.e)).toEqual(
      expect.arrayContaining(['engine created', 'run start', 'abandon stale run', 'run ok']),
    );
  });

  it('sends its sync diary to the server after a run', async () => {
    resetSyncLog();
    const db = device('a');
    const remote = createFakeRemote();
    const sent: { e: string }[][] = [];
    remote.sendLog = async (entries) => {
      sent.push(entries);
    };
    const engine = new SyncEngine(db, remote, { online: () => true });

    await engine.syncNow();

    await vi.waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]?.map((x) => x.e)).toEqual(['engine created', 'run start', 'run ok']);
    await engine.syncNow();
    await vi.waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1]?.map((x) => x.e)).toEqual(['run start', 'run ok']);
  });

  it('Sync now (forced) abandons a hung run and syncs at once; a plain request waits', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    const realUpsert = remote.upsert.bind(remote);
    const hang = vi.spyOn(remote, 'upsert').mockImplementationOnce(() => new Promise(() => {}));
    const engine = new SyncEngine(db, remote, {
      online: () => true,
      runLimitMs: 60_000,
      forceAfterMs: 0,
    });
    await save(db, 'items', newItem(USER, { type: 'task', title: 'a' }));

    const stuck = engine.syncNow();
    await vi.waitFor(() => expect(engine.getStatus().stage).toBe('sending items'));
    expect(engine.getStatus().state).toBe('syncing');
    expect(engine.getStatus().since).toBeTruthy();

    // A plain request just joins the stuck run.
    expect(engine.syncNow()).toBe(stuck);

    // The button forces a fresh run, which succeeds.
    hang.mockImplementation(realUpsert);
    await engine.syncNow({ force: true });
    expect(engine.getStatus()).toMatchObject({ state: 'idle', pending: 0, stage: undefined });
    expect(remote.rows('items').map((r) => r.title)).toEqual(['a']);
  });

  it('syncs on start, when the connection returns, on Realtime nudges and after local writes', async () => {
    const db = device('a');
    const remote = createFakeRemote();
    const engine = new SyncEngine(db, remote, { online: () => true, writeDebounceMs: 10 });
    const run = vi.spyOn(engine, 'syncNow');

    const stop = engine.start();
    expect(run).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(2);

    remote.emitChange();
    expect(run).toHaveBeenCalledTimes(3);

    await save(db, 'items', newItem(USER, { type: 'task', title: 'typed' }));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(4));

    stop();
    window.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(4);
  });
});
