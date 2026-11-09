import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openUserDb, type AirheadDb } from './db';
import { createNote, notesWaitingForAi, saveDoc } from './notes';

const U = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
let db: AirheadDb;
beforeEach(async () => {
  db = openUserDb(`${U}-notes`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('note documents (Task 6.1)', () => {
  it('a note is an item plus a document with the same id', async () => {
    const { item, doc } = await createNote(db, U, DEVICE, {
      type: 'meeting',
      kind: 'typed',
      title: '',
    });
    expect(item).toMatchObject({
      type: 'meeting',
      title: 'Meeting notes',
      data: { doc_kind: 'typed' },
    });
    expect(doc).toMatchObject({
      id: item.id,
      kind: 'typed',
      doc: { html: '' },
      version: 0,
      writer_device: DEVICE,
    });
    expect(await db.outbox.count()).toBe(2);
  });

  it('a handwritten note starts with one empty page', async () => {
    const { doc } = await createNote(db, U, DEVICE, { type: 'note', kind: 'ink', title: 'Sketch' });
    expect(doc.doc).toEqual({ width: 1000, pages: [{ height: 1400, strokes: [], texts: [] }] });
  });

  it('saving records the version the edit was based on and this device', async () => {
    const { doc } = await createNote(db, U, DEVICE, { type: 'note', kind: 'typed', title: 'Plan' });
    // As if a pull had brought server version 4.
    await db.note_docs.put({ ...doc, version: 4, base_version: 4, writer_device: null });
    const saved = await saveDoc(db, DEVICE, doc.id, { html: '<p>Hello</p>' });
    expect(saved).toMatchObject({
      doc: { html: '<p>Hello</p>' },
      version: 4,
      base_version: 4,
      writer_device: DEVICE,
    });
    expect(await saveDoc(db, DEVICE, '33333333-3333-4333-8333-333333333333', {})).toBeUndefined();
  });
});

describe('notes waiting for AI sorting (Task 11.0)', () => {
  it('a typed note with text waits until AI sorting has seen it; an empty or ink note never does', async () => {
    const { item } = await createNote(db, U, DEVICE, { type: 'note', kind: 'typed', title: '' });
    await createNote(db, U, DEVICE, { type: 'note', kind: 'ink', title: 'Sketch' });
    expect(await notesWaitingForAi(db)).toBe(0); // empty

    await saveDoc(db, DEVICE, item.id, { html: '<p>need to send the report to Trevor</p>' });
    expect(await notesWaitingForAi(db)).toBe(1);

    // The server stamps the note when sorting has looked at it.
    const later = new Date(Date.now() + 60_000).toISOString();
    await db.items.update(item.id, {
      updated_at: later,
      data: { ...item.data, ai_seen_at: later },
    });
    expect(await notesWaitingForAi(db)).toBe(0);
  });
});
