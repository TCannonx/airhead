import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
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
import AiActions from './AiActions';
import { INBOX_WAITING } from './useInboxCount';

// needs_review captures show their unsure items under "Needs a tap" instead.
const WAITING = INBOX_WAITING;

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
      {children}
    </h2>
  );
}

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

  return (
    <Page title="Inbox">
      <AiActions />
      {((unsure && unsure.length > 0) || (pendingFacts && pendingFacts.length > 0)) && (
        <section className="mb-8">
          <SectionHeading>Needs a tap</SectionHeading>
          <ul aria-label="Needs a tap" className="space-y-2">
            {pendingFacts?.map((f) => (
              <li
                key={f.id}
                className="rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/40"
              >
                <p className="font-medium">{f.text}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Should Airhead remember this? It&apos;s about{' '}
                  {f.category === 'person' ? 'a person' : 'something personal'}, so it asks first.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                    onClick={() => void approveFact(db, f.id)}
                  >
                    Remember
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    onClick={() => void rejectFact(db, f.id)}
                  >
                    Don’t remember
                  </button>
                </div>
              </li>
            ))}
            {(unsure ?? []).map((i) => (
              <li
                key={i.id}
                className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
              >
                <p className="font-medium">{i.title}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {typeof i.data.proposed_list === 'string'
                    ? `For a list called “${i.data.proposed_list}”, which doesn’t exist yet.`
                    : `Sorted as ${TYPE_LABELS[i.type].toLowerCase()}, but not sure. Is that right?`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {typeof i.data.proposed_list === 'string' ? (
                    <button
                      type="button"
                      className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                      onClick={() => void createListFromSuggestion(db, user?.id ?? '', i.id)}
                    >
                      Create list &apos;{i.data.proposed_list}&apos;
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                      onClick={() => void resolveSuggestion(db, user?.id ?? '', i.id, i.type)}
                    >
                      Keep as {TYPE_LABELS[i.type]}
                    </button>
                  )}
                  {SORTABLE_TYPES.filter((t) => t !== i.type).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                      onClick={() => void resolveSuggestion(db, user?.id ?? '', i.id, t)}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <div className="flex items-start justify-between gap-3">
          <SectionHeading>Unsorted</SectionHeading>
          {sort.available &&
            ((unsorted && unsorted.some((c) => c.status === 'unsorted')) || !!notesWaiting) && (
              <button
                type="button"
                disabled={sort.running}
                onClick={() => void sort.sortNow()}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {sort.running ? 'Sorting…' : 'Sort now'}
              </button>
            )}
        </div>
        {sort.last && (
          <p className="mb-2 text-sm text-slate-500" aria-live="polite">
            {sort.last.message}
          </p>
        )}
        {unsorted && unsorted.length === 0 && (
          <p className="text-sm text-slate-500">Nothing waiting. Everything is sorted.</p>
        )}
        <ul aria-label="Unsorted" className="space-y-2">
          {unsorted?.map((c) => (
            <li key={c.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">{c.text ?? c.url}</p>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {captureChip(c, actions)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Sort as">
                {SORTABLE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-label={`Sort as ${TYPE_LABELS[type]}`}
                    className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                    onClick={() => void sortCaptureAs(db, user?.id ?? '', c.id, type)}
                  >
                    {TYPE_LABELS[type]}
                  </button>
                ))}
                <button
                  type="button"
                  className="rounded-full border border-indigo-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
                  onClick={() => void sendCaptureToWorkshop(db, user?.id ?? '', c.id)}
                >
                  Send to Workshop
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading>To flesh out</SectionHeading>
        {workshop && workshop.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ideas you send to the Workshop to flesh out appear here.
          </p>
        ) : (
          <ul aria-label="To flesh out" className="space-y-2">
            {workshop?.map((i) => (
              <li
                key={i.id}
                className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
              >
                <Link to={`/workshop/${i.id}`} className="hover:underline">
                  {i.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
