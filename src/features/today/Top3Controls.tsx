import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useDb } from '../../lib/db/context';
import { carryOver, completeTask, dropTask } from '../../lib/db/review';
import { addToTop3, carryOverCandidates, removeFromTop3, swapIntoTop3 } from '../../lib/db/top3';
import type { Item } from '../../lib/schemas/records';
import { addDays } from '../../lib/holidays/easter';
import { deviceTimeZone } from '../calendar/useCalendarData';
import { todayKey } from '../leave/useWork';
import { Button } from '../../ui/Button';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';

/** "Add to today's Top 3" on a task, with a swap choice when three are already picked (Task 5.8). */
export function Top3Button({ item }: { item: Item }) {
  const db = useDb();
  const today = todayKey();
  const [full, setFull] = useState<Item[] | null>(null);
  if (item.type !== 'task' || item.status !== 'open') return null;
  if (item.top3_date === today) {
    return (
      <Button size="sm" onClick={() => void removeFromTop3(db, item.id)}>
        Remove from today’s Top 3
      </Button>
    );
  }
  return (
    <div>
      <Button
        size="sm"
        onClick={() =>
          void addToTop3(db, item.id, today).then((r) => setFull(r.added ? null : r.full))
        }
      >
        Add to today’s Top 3
      </Button>
      {full && (
        <div
          role="group"
          aria-label="Swap with"
          className="mt-2 rounded-card border border-border bg-surface p-3"
        >
          <p className="mb-2 text-footnote text-fg-muted">Today’s Top 3 is full. Swap with:</p>
          <div className="flex flex-wrap gap-2">
            {full.map((f) => (
              <Button
                key={f.id}
                size="sm"
                onClick={() =>
                  void swapIntoTop3(db, f.id, item.id, today).then(() => setFull(null))
                }
              >
                {f.title}
              </Button>
            ))}
            <Button variant="plain" size="sm" onClick={() => setFull(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Morning cards for yesterday's unfinished tasks: Done, Today or Drop (Task 5.8). */
export function CarryOverCards() {
  const db = useDb();
  const tz = deviceTimeZone();
  const today = todayKey();
  const items = useLiveQuery(
    async () =>
      carryOverCandidates(await db.items.where('type').equals('task').toArray(), today, tz),
    [db, today, tz],
  );
  if (!items?.length) return null;
  const yesterday = addDays(today, -1);
  return (
    <Section title="From yesterday">
      <GroupedList label="From yesterday">
        {items.map((i) => (
          <GroupedListItem key={i.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 flex-1 text-body font-medium break-words">{i.title}</span>
            <span className="flex gap-2">
              <Button
                size="sm"
                aria-label={`Done: ${i.title}`}
                onClick={() => void completeTask(db, i.id)}
              >
                Done
              </Button>
              <Button
                size="sm"
                variant="primary"
                aria-label={`Today: ${i.title}`}
                onClick={() =>
                  void carryOver(db, i, yesterday, tz).then(() => addToTop3(db, i.id, today))
                }
              >
                Today
              </Button>
              <Button
                size="sm"
                variant="plain"
                aria-label={`Drop: ${i.title}`}
                onClick={() => void dropTask(db, i.id)}
              >
                Drop
              </Button>
            </span>
          </GroupedListItem>
        ))}
      </GroupedList>
    </Section>
  );
}
