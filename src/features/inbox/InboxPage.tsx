import { useLiveQuery } from 'dexie-react-hooks';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { captureChip } from '../../lib/db/captures';
import { useDb } from '../../lib/db/context';
import { SORTABLE_TYPES, sortCaptureAs, TYPE_LABELS } from '../../lib/db/sorting';

const WAITING = new Set(['unsorted', 'needs_review', 'failed']);

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
  const unsorted = useLiveQuery(
    () =>
      db.captures
        .orderBy('captured_at')
        .reverse()
        .filter((c) => !c.deleted_at && WAITING.has(c.status))
        .toArray(),
    [db],
  );
  const workshop = useLiveQuery(
    () => db.items.filter((i) => !i.deleted_at && i.data.workshop === true).toArray(),
    [db],
  );

  return (
    <Page title="Inbox">
      <section className="mb-8">
        <SectionHeading>Unsorted</SectionHeading>
        {unsorted && unsorted.length === 0 && (
          <p className="text-sm text-slate-500">Nothing waiting. Everything is sorted.</p>
        )}
        <ul aria-label="Unsorted" className="space-y-2">
          {unsorted?.map((c) => (
            <li key={c.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">{c.text ?? c.url}</p>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {captureChip(c)}
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
                {i.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
