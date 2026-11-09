import { Link } from 'react-router';
import { useDb } from '../../lib/db/context';
import { update } from '../../lib/db/repository';
import { completeTask } from '../../lib/db/review';
import { removeFromTop3 } from '../../lib/db/top3';
import type { Item } from '../../lib/schemas/records';
import { Button } from '../../ui/Button';
import { buttonClasses } from '../../ui/buttonClasses';
import { cx } from '../../ui/cx';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { IconButton } from '../../ui/IconButton';
import StartNotesButton from '../notes/StartNotesButton';
import { hhmmOf, slotTimes, type TodayView, type TopTask } from './useToday';

export function BriefLines({ view }: { view: TodayView }) {
  if (!view.brief?.content.reflection) return null;
  return (
    <p aria-label="Morning brief" className="mb-6 px-1 text-headline font-normal text-fg">
      {view.brief.content.reflection}
    </p>
  );
}

export function TodayEvents({ view, compact = false }: { view: TodayView; compact?: boolean }) {
  if (view.events.length === 0) return null;
  return (
    <Section title="Today" className={compact ? 'mb-6' : undefined}>
      <GroupedList label="Today's events">
        {view.events.map((e) => (
          <GroupedListItem key={e.id} className="flex min-h-11 items-center gap-3 py-2">
            <span className="w-14 shrink-0 text-footnote text-fg-muted tabular-nums">
              {e.allDay ? 'All day' : hhmmOf(e.start)}
            </span>
            <span
              aria-hidden="true"
              className="h-5 w-1 shrink-0 rounded-full"
              style={{ background: e.color }}
            />
            <span className="min-w-0 flex-1 text-body break-words">{e.title}</span>
            {e.extendedProps.itemId && (
              <StartNotesButton
                eventKey={
                  e.extendedProps.occurrence
                    ? `${e.extendedProps.itemId}|${e.extendedProps.occurrence}`
                    : e.extendedProps.itemId
                }
                title={e.title}
                date={view.date}
                className={buttonClasses('plain', 'sm', '-mr-2')}
              />
            )}
          </GroupedListItem>
        ))}
      </GroupedList>
    </Section>
  );
}

/** A round tick box, 44 px to tap, that completes or reopens a task. */
function Done({ item }: { item: Item }) {
  const db = useDb();
  const done = item.status === 'done';
  return (
    <label className="-my-2 -ml-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        aria-label={`Done: ${item.title}`}
        checked={done}
        className="size-5 cursor-pointer accent-accent"
        onChange={() =>
          void (done
            ? update(db, 'items', item.id, { status: 'open', completed_at: null })
            : completeTask(db, item.id))
        }
      />
    </label>
  );
}

function TopRow({ t, date, compact }: { t: TopTask; date: string; compact: boolean }) {
  const db = useDb();
  const blocked = !!t.item.start_at;
  return (
    <GroupedListItem className="flex items-start gap-2">
      <Done item={t.item} />
      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'text-body break-words',
            t.item.status === 'done' ? 'text-fg-subtle line-through' : 'font-medium',
          )}
        >
          {t.item.title}
        </p>
        {t.why && <p className="text-footnote text-fg-muted">{t.why}</p>}
        {t.item.status === 'open' &&
          (blocked ? (
            <p className="mt-0.5 text-footnote text-fg-muted">
              On the calendar at {hhmmOf(t.item.start_at ?? '')}
            </p>
          ) : t.slot ? (
            <Button
              variant="plain"
              size="sm"
              className="-ml-3"
              onClick={() =>
                void update(
                  db,
                  'items',
                  t.item.id,
                  slotTimes(date, t.slot ?? { start: '', end: '' }),
                )
              }
            >
              Block {t.slot.start}–{t.slot.end}
            </Button>
          ) : (
            <p className="mt-0.5 text-footnote text-fg-muted">No free slot today</p>
          ))}
      </div>
      {!compact && t.item.status === 'open' && t.item.top3_date === date && (
        <IconButton
          icon="close"
          label={`Remove from Top 3: ${t.item.title}`}
          className="-my-2 -mr-2"
          onClick={() => void removeFromTop3(db, t.item.id)}
        />
      )}
    </GroupedListItem>
  );
}

export function Top3({ view, compact = false }: { view: TodayView; compact?: boolean }) {
  return (
    <Section
      title="Top 3"
      className={compact ? 'mb-6' : undefined}
      footer={
        !view.brief && !compact
          ? 'Picked on this device (overdue, due today, then what keeps slipping) until the morning brief arrives.'
          : undefined
      }
    >
      {view.top3.length === 0 ? (
        <GroupedList>
          <GroupedListItem>
            <p className="text-body text-fg-muted">Nothing pressing today.</p>
          </GroupedListItem>
        </GroupedList>
      ) : (
        <GroupedList label="Top 3">
          {view.top3.map((t) => (
            <TopRow key={t.item.id} t={t} date={view.date} compact={compact} />
          ))}
        </GroupedList>
      )}
    </Section>
  );
}

export function AlsoToday({ view }: { view: TodayView }) {
  if (view.also.length === 0) return null;
  return (
    <details className="group mb-8">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 px-4 text-footnote font-medium tracking-wide text-fg-muted uppercase marker:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        <span>Also today ({view.also.length})</span>
      </summary>
      <GroupedList label="Also today" className="mt-1">
        {view.also.map((i) => (
          <GroupedListItem key={i.id} className="flex items-center gap-2 py-2">
            <Done item={i} />
            <Link
              to={`/library/item/${i.id}`}
              className="min-w-0 flex-1 py-1 text-body break-words hover:text-accent"
            >
              {i.title}
            </Link>
          </GroupedListItem>
        ))}
      </GroupedList>
    </details>
  );
}
