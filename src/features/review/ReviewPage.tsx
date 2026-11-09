import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { Page } from '../../app/Page';
import { useDb } from '../../lib/db/context';
import { carryOver, completeTask, dropTask, reviewTasks } from '../../lib/db/review';
import { deviceTimeZone } from '../calendar/useCalendarData';
import { todayKey } from '../leave/useWork';
import { Button } from '../../ui/Button';
import { buttonClasses } from '../../ui/buttonClasses';
import { Chip } from '../../ui/Chip';
import { EmptyState } from '../../ui/EmptyState';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';

/** The evening review (Task 4.14): opened from the 21:00 notification or from Today. */
export default function ReviewPage() {
  const db = useDb();
  const tz = deviceTimeZone();
  const today = todayKey();
  const tasks = useLiveQuery(
    async () => reviewTasks(await db.items.where('type').equals('task').toArray(), today, tz),
    [db, today, tz],
  );
  if (!tasks) return null;

  return (
    <Page title="Evening review" back={{ to: '/today', label: 'Today' }}>
      {tasks.length === 0 ? (
        <EmptyState
          icon="check"
          title="All done for today."
          message="Nothing left open. Enjoy the evening."
          action={
            <Link to="/today" className={buttonClasses('secondary', 'md')}>
              Back to Today
            </Link>
          }
        />
      ) : (
        <Section
          footer={
            tasks.length > 1 ? (
              <Button
                className="mt-2 -ml-1"
                onClick={() => void Promise.all(tasks.map((t) => carryOver(db, t, today, tz)))}
              >
                Carry all to tomorrow
              </Button>
            ) : undefined
          }
        >
          <p className="mb-3 px-4 text-footnote text-fg-muted">
            {tasks.length} open task{tasks.length === 1 ? '' : 's'} from today. Tick off what’s
            done, carry the rest to tomorrow, or let it go.
          </p>
          <GroupedList label="Today's open tasks">
            {tasks.map((t) => (
              <GroupedListItem
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-body font-medium break-words">{t.title}</span>
                  {t.carry_count > 0 && (
                    <Chip tone="warning" className="ml-2">
                      carried over {t.carry_count}×
                    </Chip>
                  )}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    aria-label={`Done: ${t.title}`}
                    className="text-success"
                    onClick={() => void completeTask(db, t.id)}
                  >
                    Done
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    aria-label={`Carry over: ${t.title}`}
                    onClick={() => void carryOver(db, t, today, tz)}
                  >
                    Tomorrow
                  </Button>
                  <Button
                    size="sm"
                    variant="plain"
                    aria-label={`Drop: ${t.title}`}
                    onClick={() => void dropTask(db, t.id)}
                  >
                    Drop
                  </Button>
                </span>
              </GroupedListItem>
            ))}
          </GroupedList>
        </Section>
      )}
    </Page>
  );
}
