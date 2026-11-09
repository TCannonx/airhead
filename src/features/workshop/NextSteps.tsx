import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { actionKey, actionsToTasks, tasksFromNote } from '../../lib/db/actions';
import { useDb } from '../../lib/db/context';
import { deviceTimeZone } from '../calendar/useCalendarData';
import { Button } from '../../ui/Button';

/**
 * A draft's next steps become tasks in one tap (Task 7.8). All are ticked to
 * start (in the Workshop the person is already deciding); untick any to skip.
 * Tasks link back to the idea (`data.idea_id`).
 */
export default function NextSteps({ itemId, steps }: { itemId: string; steps: string[] }) {
  const db = useDb();
  const { user } = useAuth();
  const made = useLiveQuery(() => tasksFromNote(db, itemId, 'idea_id'), [db, itemId], new Map());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const open = steps.filter((s) => !made.has(actionKey(s)));
  const picked = open.filter((s) => !skipped.has(actionKey(s)));

  const add = async () => {
    setBusy(true);
    try {
      const tasks = await actionsToTasks(
        db,
        user?.id ?? '',
        { id: itemId },
        picked.map((title) => ({ title, owner: null, due_text: null })),
        { timeZone: deviceTimeZone(), link: 'idea_id' },
      );
      setMessage(`Added ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}.`);
    } finally {
      setBusy(false);
    }
  };

  if (steps.length === 0) return null;
  return (
    <section aria-label="Next steps">
      <h3 className="font-semibold">Next steps</h3>
      <ul className="space-y-1">
        {steps.map((s, i) => {
          const key = actionKey(s);
          const done = made.has(key);
          return (
            <li key={i}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={done || !skipped.has(key)}
                  disabled={done}
                  onChange={(e) =>
                    setSkipped((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                />
                <span>
                  {s}
                  {done && <span className="ml-1 text-caption text-success">Task added</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {open.length > 0 && (
        <Button
          size="sm"
          className="mt-2"
          disabled={busy || picked.length === 0}
          onClick={() => void add()}
        >
          {picked.length === 1 ? 'Add 1 task' : `Add ${picked.length} tasks`}
        </Button>
      )}
      {message && (
        <p role="status" className="mt-1 text-footnote text-fg-muted">
          {message}
        </p>
      )}
    </section>
  );
}
