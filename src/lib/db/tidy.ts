import type { Capture, Item, MemoryFact, NoteDoc } from '../schemas/records';
import type { AirheadDb } from './db';
import { createNote, saveDoc } from './notes';
import { softDelete, update } from './repository';

/**
 * Applying the weekly review's Tidy-up and memory proposals (Task 8.4), only
 * when the person taps. Keep marks the item so it isn't offered again;
 * archive hides it from lists (still searchable); delete moves it to the
 * Trash (30 days); condense merges notes or ideas into one note with a dated
 * timeline of the originals and archives them.
 */
export interface Proposal {
  kind: 'item' | 'capture';
  id: string;
  title: string;
  item_type: string | null;
  proposal: 'keep' | 'archive' | 'condense' | 'delete';
  reason: string;
  group: number | null;
}

export type ProposalState = 'open' | 'kept' | 'archived' | 'deleted' | 'condensed' | 'gone';

/** What has already happened to a proposal's item (so the card shows it as done). */
export function proposalState(p: Proposal, item: Item | Capture | undefined): ProposalState {
  if (!item) return 'gone';
  if (item.deleted_at) return 'deleted';
  if (p.kind === 'item') {
    const data = (item as Item).data;
    if (typeof data.condensed_into === 'string') return 'condensed';
    if (data.archived === true) return 'archived';
    if (data.keep === true) return 'kept';
  }
  return 'open';
}

export async function keepItem(db: AirheadDb, p: Proposal): Promise<void> {
  if (p.kind !== 'item') return;
  const item = await db.items.get(p.id);
  if (item) await update(db, 'items', p.id, { data: { ...item.data, keep: true } });
}

export async function archiveItem(db: AirheadDb, p: Proposal): Promise<void> {
  if (p.kind === 'capture') {
    await softDelete(db, 'captures', p.id);
    return;
  }
  const item = await db.items.get(p.id);
  if (item) await update(db, 'items', p.id, { data: { ...item.data, archived: true } });
}

export async function deleteProposal(db: AirheadDb, p: Proposal): Promise<void> {
  await softDelete(db, p.kind === 'item' ? 'items' : 'captures', p.id);
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text of a note document or an item body, for the timeline. */
function itemText(item: Item, doc: NoteDoc | undefined): string {
  if (doc?.kind === 'typed' && typeof doc.doc.html === 'string')
    return doc.doc.html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return (item.body ?? '').trim();
}

/** Builds the merged note's HTML: one dated section per original, oldest first. */
export function timelineHtml(parts: { date: string; title: string; text: string }[]): string {
  return parts
    .map(
      (p) =>
        `<h2>${escape(p.date)} — ${escape(p.title)}</h2>${p.text ? `<p>${escape(p.text)}</p>` : ''}`,
    )
    .join('');
}

export async function condense(
  db: AirheadDb,
  userId: string,
  deviceId: string,
  ids: string[],
  title: string,
): Promise<Item | null> {
  const items = (await db.items.bulkGet(ids)).filter(
    (i): i is Item => !!i && !i.deleted_at && typeof i.data.condensed_into !== 'string',
  );
  if (items.length < 2) return null;
  items.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const docs = await db.note_docs.bulkGet(items.map((i) => i.id));
  const html = timelineHtml(
    items.map((i, n) => ({
      date: i.created_at.slice(0, 10),
      title: i.title,
      text: itemText(i, docs[n] ?? undefined),
    })),
  );
  const { item: merged } = await createNote(db, userId, deviceId, {
    type: 'note',
    kind: 'typed',
    title,
    data: { condensed_from: items.map((i) => i.id) },
  });
  await saveDoc(db, deviceId, merged.id, { html });
  for (const i of items)
    await update(db, 'items', i.id, {
      data: { ...i.data, archived: true, condensed_into: merged.id },
    });
  return merged;
}

/** Fact merge: the first fact takes the merged text, the others are removed. */
export async function mergeFacts(db: AirheadDb, ids: string[], text: string): Promise<void> {
  const facts = (await db.memory_facts.bulkGet(ids)).filter(
    (f): f is MemoryFact => !!f && !f.deleted_at,
  );
  const [first, ...rest] = facts;
  if (!first) return;
  await update(db, 'memory_facts', first.id, { text: text.trim() });
  for (const f of rest) await softDelete(db, 'memory_facts', f.id);
}

export async function retireFact(db: AirheadDb, id: string): Promise<void> {
  await update(db, 'memory_facts', id, { status: 'archived' });
}
