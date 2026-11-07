import { analyseCapture, DEFAULT_TIME_ZONE } from '../rules';
import type { NoteSummary } from '../auth/types';
import type { Item } from '../schemas/records';
import type { AirheadDb } from './db';
import { newItem, save } from './repository';

export type ActionItem = NoteSummary['actions'][number];

/**
 * Action items to tasks (Task 6.8). Only the actions the user ticks become
 * tasks; each is linked to its note (`data.note_id`) and its due text
 * ("Friday", "by 3 March") is read by the free date rules. An action counts as
 * done when the note already has a task with the same title (so "Summarise
 * again" doesn't offer it twice).
 */
export function parseDue(
  dueText: string | null,
  { now = new Date(), timeZone = DEFAULT_TIME_ZONE }: { now?: Date; timeZone?: string } = {},
): string | null {
  if (!dueText?.trim()) return null;
  return analyseCapture(dueText, { now, timeZone }).when?.start ?? null;
}

export const actionKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

/** Which field links a task to where it came from: a note (6.8) or a Workshop idea (7.8). */
export type TaskLink = 'note_id' | 'idea_id';

/** The tasks already made from this source, by `actionKey` of their title. */
export async function tasksFromNote(
  db: AirheadDb,
  sourceId: string,
  link: TaskLink = 'note_id',
): Promise<Map<string, Item>> {
  const tasks = await db.items.where('type').equals('task').toArray();
  const out = new Map<string, Item>();
  for (const t of tasks)
    if (!t.deleted_at && t.data[link] === sourceId) out.set(actionKey(t.title), t);
  return out;
}

export async function actionsToTasks(
  db: AirheadDb,
  userId: string,
  note: Pick<Item, 'id'>,
  picks: ActionItem[],
  opts: { now?: Date; timeZone?: string; link?: TaskLink } = {},
): Promise<Item[]> {
  const link = opts.link ?? 'note_id';
  const existing = await tasksFromNote(db, note.id, link);
  const made: Item[] = [];
  for (const action of picks) {
    const key = actionKey(action.title);
    if (!key || existing.has(key)) continue;
    const task = await save(
      db,
      'items',
      newItem(userId, {
        type: 'task',
        title: action.title.trim(),
        body: action.owner ? `Owner: ${action.owner}` : null,
        due_at: parseDue(action.due_text, opts),
        data: {
          [link]: note.id,
          ...(action.owner ? { owner: action.owner } : {}),
          ...(action.due_text ? { due_text: action.due_text } : {}),
        },
      }),
    );
    made.push(task);
    existing.set(key, task);
  }
  return made;
}
