import type { Capture, FollowUp } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, newCapture, save, update } from './repository';

/**
 * Questions Airhead asks about a note (Task 12.2). Answering never blocks: an
 * answer is the person's own words, saved as a capture linked to the question,
 * and the next sorting batch acts on it. Dismissing counts as a correction.
 * Every write is an ordinary local edit, so it works offline and syncs.
 */

/** Open questions, newest first (optionally only those about one item). */
export async function openFollowUps(db: AirheadDb, itemId?: string): Promise<FollowUp[]> {
  const rows = itemId
    ? await db.follow_ups.where('item_id').equals(itemId).toArray()
    : await db.follow_ups.where('status').equals('open').toArray();
  return rows
    .filter((f) => f.status === 'open' && !f.deleted_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Answers a question: it is marked answered and the answer becomes a capture
 * (payload.follow_up_id, the question and the item id) for the next batch.
 * Returns the capture, or null for an empty answer or a question no longer open.
 */
export async function answerFollowUp(
  db: AirheadDb,
  userId: string,
  id: string,
  answer: string,
): Promise<Capture | null> {
  const text = answer.trim();
  const f = await db.follow_ups.get(id);
  if (!text || !f || f.status !== 'open' || f.deleted_at) return null;
  await update(db, 'follow_ups', id, { status: 'answered', answer: text });
  return save(
    db,
    'captures',
    newCapture(userId, {
      text,
      payload: {
        follow_up_id: f.id,
        question: f.question,
        item_id: f.item_id,
        round: f.round,
      },
    }),
  );
}

/** Dismisses a question; it counts as a correction ("not useful"). */
export async function dismissFollowUp(db: AirheadDb, userId: string, id: string): Promise<void> {
  const f = await db.follow_ups.get(id);
  if (!f || f.status !== 'open') return;
  await update(db, 'follow_ups', id, { status: 'dismissed' });
  await save(db, 'corrections', {
    ...baseRecord(userId),
    capture_id: f.capture_id,
    from_value: { follow_up: f.question },
    to_value: { follow_up: 'dismissed', reason: 'not useful' },
  });
}

/** Where a question came from, in a few words: the capture's text or the note's title. */
export async function followUpSource(db: AirheadDb, f: FollowUp): Promise<string | null> {
  if (f.capture_id) {
    const c = await db.captures.get(f.capture_id);
    const text = (c?.text ?? c?.url ?? '').trim();
    if (text) return text;
  }
  if (f.note_id) return (await db.items.get(f.note_id))?.title ?? null;
  return null;
}
