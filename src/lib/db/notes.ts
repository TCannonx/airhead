import type { Item, NoteDoc } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, newItem, save } from './repository';

/**
 * Notes (Task 6.1): a note or meeting item plus its document (same id). The
 * document carries the version its edits were based on and the device that
 * wrote them, so the sync engine can keep both versions when two devices
 * edit the same note offline (Task 6.2).
 */
export type DocKind = NoteDoc['kind'];

export async function createNote(
  db: AirheadDb,
  userId: string,
  deviceId: string,
  fields: { type: 'note' | 'meeting'; kind: DocKind; title: string; data?: Item['data'] },
): Promise<{ item: Item; doc: NoteDoc }> {
  const item = await save(
    db,
    'items',
    newItem(userId, {
      type: fields.type,
      title: fields.title.trim() || (fields.type === 'meeting' ? 'Meeting notes' : 'Note'),
      data: { ...fields.data, doc_kind: fields.kind },
    }),
  );
  const doc = await save(db, 'note_docs', {
    ...baseRecord(userId),
    id: item.id,
    kind: fields.kind,
    doc:
      fields.kind === 'ink'
        ? { width: 1000, pages: [{ height: 1400, strokes: [], texts: [] }] }
        : { html: '' },
    version: 0,
    base_version: 0,
    writer_device: deviceId,
    summary: null,
  });
  return { item, doc };
}

/** Saves the whole document locally (sync pushes it a few seconds later). */
export async function saveDoc(
  db: AirheadDb,
  deviceId: string,
  id: string,
  doc: NoteDoc['doc'],
): Promise<NoteDoc | undefined> {
  const current = await db.note_docs.get(id);
  if (!current) return undefined;
  return save(db, 'note_docs', {
    ...current,
    doc,
    // The last server version this device had seen when it made this edit.
    base_version: current.version,
    writer_device: deviceId,
  });
}

/** The meeting note started from an event, if there is one. */
export async function notesForEvent(db: AirheadDb, eventId: string): Promise<Item | undefined> {
  return (await db.items.where('type').equals('meeting').toArray()).find(
    (i) => !i.deleted_at && i.data.event_id === eventId,
  );
}

/**
 * "Start notes" on an event (Task 6.4): opens its meeting note, or makes one
 * with the event's title and date, linked to the event. The key is the event's
 * id, or id|occurrence for one meeting of a repeating series.
 */
export async function startNotesFor(
  db: AirheadDb,
  userId: string,
  deviceId: string,
  event: { key: string; title: string; date: string },
): Promise<Item> {
  const existing = await notesForEvent(db, event.key);
  if (existing) return existing;
  const { item } = await createNote(db, userId, deviceId, {
    type: 'meeting',
    kind: 'typed',
    title: event.title,
    data: { event_id: event.key, meeting_date: event.date, attendees: [] },
  });
  return item;
}

/**
 * How many of the person's own notes, meeting notes and ideas changed since AI
 * sorting last looked at them (Task 11.0), as this device sees it. Sort now is
 * offered for these even when no capture is waiting. Mirrors the server's
 * notes_waiting_for_ai (migration 0035) closely enough to show a button.
 */
export async function notesWaitingForAi(db: AirheadDb): Promise<number> {
  const items = (await db.items.where('type').anyOf('note', 'meeting', 'idea').toArray()).filter(
    (i) =>
      !i.deleted_at &&
      !i.capture_id &&
      (i.status === 'open' || i.status === 'done') &&
      (i.data.doc_kind ?? 'typed') === 'typed' &&
      !('from_note_id' in i.data) &&
      !('condensed_from' in i.data) &&
      i.data.archived !== true,
  );
  const docs = await db.note_docs.bulkGet(items.map((i) => i.id));
  return items.filter((item, n) => {
    const doc = docs[n];
    const html = doc && typeof doc.doc.html === 'string' ? doc.doc.html : null;
    const hasText = doc
      ? html !== null && /\S/.test(html.replace(/<[^>]*>/g, ''))
      : !!item.body?.trim() || item.type === 'idea';
    if (!hasText) return false;
    const seen = typeof item.data.ai_seen_at === 'string' ? Date.parse(item.data.ai_seen_at) : 0;
    const changed = Math.max(Date.parse(item.updated_at), doc ? Date.parse(doc.updated_at) : 0);
    return !(changed <= seen);
  }).length;
}
