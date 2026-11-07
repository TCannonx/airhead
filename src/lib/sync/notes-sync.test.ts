import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openUserDb, type AirheadDb } from '../db/db';
import { createNote, saveDoc } from '../db/notes';
import { pull, push } from './engine';
import { createFakeRemote } from './fakeRemote';

const USER = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
let dbs: AirheadDb[] = [];
const device = (name: string) => {
  const db = openUserDb(`${USER}-${name}`);
  dbs.push(db);
  return db;
};
beforeEach(() => {
  dbs = [];
});
afterEach(async () => {
  for (const db of dbs) {
    db.close();
    await db.delete();
  }
});

const sync = async (db: AirheadDb, remote: ReturnType<typeof createFakeRemote>) => {
  await push(db, remote);
  await pull(db, remote);
};
const html = async (db: AirheadDb) =>
  (await db.note_docs.toArray()).map((d) => String(d.doc.html)).sort();

describe('note conflict copies (Task 6.2)', () => {
  it('no conflict: edits hand over between devices', async () => {
    const remote = createFakeRemote();
    const a = device('a');
    const b = device('b');
    const { item } = await createNote(a, USER, A, { type: 'note', kind: 'typed', title: 'Plan' });
    await saveDoc(a, A, item.id, { html: 'A1' });
    await sync(a, remote);
    await sync(b, remote);
    await saveDoc(b, B, item.id, { html: 'B2' });
    await sync(b, remote);
    await sync(a, remote);
    expect(await html(a)).toEqual(['B2']);
    expect(await a.items.count()).toBe(1);
  });

  it('a device’s own earlier push coming back is not a conflict', async () => {
    const remote = createFakeRemote();
    const a = device('a');
    const { item } = await createNote(a, USER, A, { type: 'note', kind: 'typed', title: 'Plan' });
    await push(a, remote);
    // Typing continues before the pull brings the pushed version back.
    await saveDoc(a, A, item.id, { html: 'still typing' });
    await pull(a, remote);
    await push(a, remote);
    await pull(a, remote);
    expect(await html(a)).toEqual(['still typing']);
    expect(await a.note_docs.count()).toBe(1);
    expect(remote.rows('note_docs')).toHaveLength(1);
  });

  it('both devices edit while one is offline: both versions are kept', async () => {
    const remote = createFakeRemote();
    const a = device('a');
    const b = device('b');
    const { item } = await createNote(a, USER, A, {
      type: 'meeting',
      kind: 'typed',
      title: 'Team sync',
    });
    await saveDoc(a, A, item.id, { html: 'shared start' });
    await sync(a, remote);
    await sync(b, remote);

    // B goes offline and edits; A edits and syncs.
    await saveDoc(b, B, item.id, { html: 'B offline' });
    await saveDoc(a, A, item.id, { html: 'A online' });
    await sync(a, remote);

    // B comes back: its push meets A's newer version on the server.
    await sync(b, remote);
    await sync(a, remote);

    for (const db of [a, b]) {
      expect(await html(db)).toEqual(['A online', 'B offline']);
      const titles = (await db.items.toArray()).map((i) => i.title).sort();
      expect(titles).toEqual(['Team sync', 'Team sync (conflicted copy)']);
    }
    expect((await a.note_docs.get(item.id))?.doc.html).toBe('A online');
  });

  it('a newer version arriving while local edits are unsent keeps both (pull first)', async () => {
    const remote = createFakeRemote();
    const a = device('a');
    const b = device('b');
    const { item } = await createNote(a, USER, A, { type: 'note', kind: 'typed', title: 'Draft' });
    await sync(a, remote);
    await sync(b, remote);
    await saveDoc(a, A, item.id, { html: 'A unsent' });
    await saveDoc(b, B, item.id, { html: 'B sent' });
    await sync(b, remote);

    // A pulls before pushing (e.g. a Realtime nudge while typing).
    await pull(a, remote);
    expect((await a.note_docs.get(item.id))?.doc.html).toBe('B sent');
    const copies = (await a.items.toArray()).filter((i) =>
      i.title.startsWith('Draft (conflicted copy'),
    );
    expect(copies).toHaveLength(1);
    expect((await a.note_docs.get(copies[0]?.id ?? ''))?.doc.html).toBe('A unsent');

    // The copy syncs like any note; the original isn't pushed over B's version.
    await push(a, remote);
    expect(
      remote
        .rows('note_docs')
        .map((d) => String(d.doc && (d.doc as { html: string }).html))
        .sort(),
    ).toEqual(['A unsent', 'B sent']);
  });
});
