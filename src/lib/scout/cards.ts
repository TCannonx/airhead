import { localMidnight } from '../calendar/sources';
import type { AirheadDb } from '../db/db';
import { addFact } from '../db/memory';
import { newItem, save, update } from '../db/repository';
import type { Item, Suggestion } from '../schemas/records';

/**
 * Scout cards (Task 8.12). Accepting creates the proposed task or event (only
 * then) and dismissing hides the card. For web ideas, both feed memory: an
 * interest fact when accepted, a "not interested" fact when dismissed. Cards
 * from the person's own data don't add facts (they'd only be noise).
 */
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function itemFromProposal(userId: string, s: Suggestion, timeZone: string): Item | null {
  const p = s.proposed;
  if (!p || typeof p.title !== 'string' || !p.title.trim()) return null;
  if (p.type === 'event' && typeof p.date === 'string' && isoDate.test(p.date))
    return newItem(userId, {
      type: 'event',
      title: p.title.trim(),
      start_at: localMidnight(p.date, timeZone),
      all_day: true,
      calendar: 'personal',
      data: { from_suggestion: s.id },
    });
  if (p.type === 'task')
    return newItem(userId, {
      type: 'task',
      title: p.title.trim(),
      body: s.source_url ?? null,
      due_at:
        typeof p.due_date === 'string' && isoDate.test(p.due_date)
          ? localMidnight(p.due_date, timeZone)
          : null,
      data: { from_suggestion: s.id },
    });
  return null;
}

export async function acceptCard(
  db: AirheadDb,
  userId: string,
  s: Suggestion,
  timeZone: string,
): Promise<Item | null> {
  const item = itemFromProposal(userId, s, timeZone);
  const saved = item ? await save(db, 'items', item) : null;
  await update(db, 'suggestions', s.id, { status: 'accepted' });
  if (s.kind === 'web') await addFact(db, userId, `Interested in: ${s.title}`, 'everyday');
  return saved;
}

export async function dismissCard(db: AirheadDb, userId: string, s: Suggestion): Promise<void> {
  await update(db, 'suggestions', s.id, { status: 'dismissed' });
  if (s.kind === 'web') await addFact(db, userId, `Not interested in: ${s.title}`, 'everyday');
}
