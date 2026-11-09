import { useLiveQuery } from 'dexie-react-hooks';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { captureChip } from '../../lib/db/captures';
import { useDb } from '../../lib/db/context';
import { createListFromSuggestion } from '../../lib/db/lists';
import { approveFact, rejectFact } from '../../lib/db/memory';
import { notesWaitingForAi } from '../../lib/db/notes';
import {
  isInboxSuggestion,
  resolveSuggestion,
  SORTABLE_TYPES,
  sortCaptureAs,
  TYPE_LABELS,
} from '../../lib/db/sorting';
import { useSort } from '../../lib/sort/context';
import { sendCaptureToWorkshop } from '../../lib/db/workshop';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { EmptyState } from '../../ui/EmptyState';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { ListRow } from '../../ui/ListRow';
import AiActions from './AiActions';
import { INBOX_WAITING } from './useInboxCount';

// needs_review captures show their unsure items under "Needs a tap" instead.
const WAITING = INBOX_WAITING;

export default function InboxPage() {
  const db = useDb();
  const { user } = useAuth();
  const sort = useSort();
  const unsorted = useLiveQuery(
    () =>
      db.captures
        .orderBy('captured_at')
        .reverse()
        .filter((c) => !c.deleted_at && WAITING.has(c.status))
        .toArray(),
    [db],
  );
  const unsure = useLiveQuery(() => db.items.filter(isInboxSuggestion).sortBy('created_at'), [db]);
  // Notes changed since AI sorting last looked (Task 11.0): Sort now looks at them too.
  const notesWaiting = useLiveQuery(() => notesWaitingForAi(db), [db]);
  const pendingFacts = useLiveQuery(
    () => db.memory_facts.filter((f) => f.status === 'pending_approval' && !f.deleted_at).toArray(),
    [db],
  );
  const actions = useLiveQuery(() => db.ai_actions.toArray(), [db]);
  const workshop = useLiveQuery(
    () => db.items.filter((i) => !i.deleted_at && i.data.workshop === true).toArray(),
    [db],
  );

  const canSort =
    sort.available &&
    ((unsorted && unsorted.some((c) => c.status === 'unsorted')) || !!notesWaiting);

  return (
    <Page title="Inbox">
      <AiActions />
      {((unsure && unsure.length > 0) || (pendingFacts && pendingFacts.length > 0)) && (
        <Section title="Needs a tap">
          <GroupedList label="Needs a tap">
            {pendingFacts?.map((f) => (
              <GroupedListItem key={f.id}>
                <p className="text-body font-medium break-words">{f.text}</p>
                <p className="text-footnote text-fg-muted">
                  Should Airhead remember this? It&apos;s about{' '}
                  {f.category === 'person' ? 'a person' : 'something personal'}, so it asks first.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => void approveFact(db, f.id)}>
                    Remember
                  </Button>
                  <Button size="sm" onClick={() => void rejectFact(db, f.id)}>
                    Don’t remember
                  </Button>
                </div>
              </GroupedListItem>
            ))}
            {(unsure ?? []).map((i) => (
              <GroupedListItem key={i.id}>
                <p className="text-body font-medium break-words">{i.title}</p>
                <p className="text-footnote text-fg-muted">
                  {typeof i.data.proposed_list === 'string'
                    ? `For a list called “${i.data.proposed_list}”, which doesn’t exist yet.`
                    : `Sorted as ${TYPE_LABELS[i.type].toLowerCase()}, but not sure. Is that right?`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {typeof i.data.proposed_list === 'string' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void createListFromSuggestion(db, user?.id ?? '', i.id)}
                    >
                      Create list &apos;{i.data.proposed_list}&apos;
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void resolveSuggestion(db, user?.id ?? '', i.id, i.type)}
                    >
                      Keep as {TYPE_LABELS[i.type]}
                    </Button>
                  )}
                  {SORTABLE_TYPES.filter((t) => t !== i.type).map((t) => (
                    <Button
                      key={t}
                      size="sm"
                      onClick={() => void resolveSuggestion(db, user?.id ?? '', i.id, t)}
                    >
                      {TYPE_LABELS[t]}
                    </Button>
                  ))}
                </div>
              </GroupedListItem>
            ))}
          </GroupedList>
        </Section>
      )}

      <Section
        title="Unsorted"
        action={
          canSort && (
            <Button
              size="sm"
              variant="primary"
              loading={sort.running}
              onClick={() => void sort.sortNow()}
            >
              {sort.running ? 'Sorting…' : 'Sort now'}
            </Button>
          )
        }
      >
        {sort.last && (
          <p className="mb-2 px-4 text-footnote text-fg-muted" aria-live="polite">
            {sort.last.message}
          </p>
        )}
        {unsorted && unsorted.length === 0 && (
          <GroupedList>
            <li>
              <EmptyState
                icon="check"
                title="All clear"
                message="Nothing waiting. Everything is sorted."
                className="py-6"
              />
            </li>
          </GroupedList>
        )}
        {unsorted && unsorted.length > 0 && (
          <GroupedList label="Unsorted">
            {unsorted.map((c) => (
              <GroupedListItem key={c.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 text-body break-words whitespace-pre-wrap">
                    {c.text ?? c.url}
                  </p>
                  <Chip className="max-w-[45%] shrink-0">{captureChip(c, actions)}</Chip>
                </div>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Sort as">
                  {SORTABLE_TYPES.map((type) => (
                    <Button
                      key={type}
                      size="sm"
                      aria-label={`Sort as ${TYPE_LABELS[type]}`}
                      onClick={() => void sortCaptureAs(db, user?.id ?? '', c.id, type)}
                    >
                      {TYPE_LABELS[type]}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="plain"
                    onClick={() => void sendCaptureToWorkshop(db, user?.id ?? '', c.id)}
                  >
                    Send to Workshop
                  </Button>
                </div>
              </GroupedListItem>
            ))}
          </GroupedList>
        )}
      </Section>

      <Section title="To flesh out">
        {workshop && workshop.length === 0 ? (
          <GroupedList>
            <GroupedListItem>
              <p className="text-footnote text-fg-muted">
                Ideas you send to the Workshop to flesh out appear here.
              </p>
            </GroupedListItem>
          </GroupedList>
        ) : (
          <GroupedList label="To flesh out">
            {workshop?.map((i) => (
              <ListRow key={i.id} title={i.title} to={`/workshop/${i.id}`} />
            ))}
          </GroupedList>
        )}
      </Section>
    </Page>
  );
}
