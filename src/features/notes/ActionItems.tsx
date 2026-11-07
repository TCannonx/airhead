import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { actionKey, actionsToTasks, tasksFromNote, type ActionItem } from '../../lib/db/actions';
import { useDb } from '../../lib/db/context';
import type { Item } from '../../lib/schemas/records';
import { deviceTimeZone } from '../calendar/useCalendarData';

/**
 * Proposed action items from Summarise (Task 6.8): a checklist, all unticked.
 * Only the ticked ones become tasks, on a tap; ones already made are shown as
 * added.
 */
export default function ActionItems({ note, actions }: { note: Item; actions: ActionItem[] }) {
  const db = useDb();
  const { user } = useAuth();
  const made = useLiveQuery(() => tasksFromNote(db, note.id), [db, note.id], new Map());
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const picked = actions.filter((a, i) => ticked.has(i) && !made.has(actionKey(a.title)));
  const add = async () => {
    setBusy(true);
    try {
      const tasks = await actionsToTasks(db, user?.id ?? '', note, picked, {
        timeZone: deviceTimeZone(),
      });
      setTicked(new Set());
      setMessage(`Added ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="font-semibold">Action items</h3>
      <ul className="space-y-1">
        {actions.map((a, i) => {
          const done = made.has(actionKey(a.title));
          const extra = [a.owner, a.due_text].filter(Boolean).join(', ');
          return (
            <li key={i}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={done || ticked.has(i)}
                  disabled={done}
                  onChange={(e) =>
                    setTicked((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    })
                  }
                />
                <span>
                  {a.title}
                  {extra && <span className="text-slate-500"> ({extra})</span>}
                  {done && (
                    <span className="ml-1 text-xs text-emerald-700 dark:text-emerald-400">
                      Task added
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {actions.some((a) => !made.has(actionKey(a.title))) && (
        <button
          type="button"
          className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"
          disabled={busy || picked.length === 0}
          onClick={() => void add()}
        >
          {picked.length > 1 ? `Add ${picked.length} as tasks` : 'Add as task'}
        </button>
      )}
      {message && (
        <p role="status" className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {message}
        </p>
      )}
    </div>
  );
}
