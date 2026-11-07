import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { draftsFor } from '../../lib/db/workshop';
import { draftSchema, type Draft } from '../../lib/schemas/records';
import { useOnline } from '../../lib/useOnline';
import { FLESH_OUT_COST_TEXT } from '../../lib/workshop/cost';
import NextSteps from './NextSteps';
import SessionPanel from './SessionPanel';

const button =
  'rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50';

function DraftView({ draft }: { draft: Draft }) {
  const c = draft.content;
  return (
    <article aria-label={`Draft version ${draft.version}`} className="space-y-3">
      {c.summary && <p>{c.summary}</p>}
      {c.sections.map((s, i) => (
        <section key={i}>
          <h3 className="font-semibold">{s.heading}</h3>
          <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{s.body}</p>
        </section>
      ))}
      {c.open_questions.length > 0 && (
        <section>
          <h3 className="font-semibold">Open questions</h3>
          <ul className="list-disc pl-5">
            {c.open_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
      <NextSteps itemId={draft.item_id} steps={c.next_steps} />
    </article>
  );
}

/**
 * The Workshop for one item (Task 7.6): its newest draft, older versions one
 * tap away, a link to the original, and Auto flesh-out (online, one AI call).
 */
export default function WorkshopPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const { services } = useAuth();
  const online = useOnline();
  const data = useLiveQuery(
    async () => ({ item: await db.items.get(id), drafts: await draftsFor(db, id) }),
    [db, id],
  );
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const workshop = services.workshop;

  if (!data) return <Page title="Workshop" />;
  const { item, drafts } = data;
  if (!item || item.deleted_at)
    return (
      <Page title="Not found">
        <Link to="/inbox" className="text-indigo-600 underline">
          Back to the Inbox
        </Link>
      </Page>
    );
  const current = drafts.find((d) => d.id === shown) ?? drafts[0];

  const fleshOut = async () => {
    if (!workshop) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await workshop.fleshOut(item.id);
      if (!res.ok) {
        setMessage(res.message);
        return;
      }
      // Show it now; the next sync brings the same row.
      const row = draftSchema.safeParse(res.draft);
      if (row.success) await db.drafts.put(row.data);
      setShown(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={item.title || 'Workshop'}>
      <p className="mb-4 text-sm">
        <Link to={`/library/item/${item.id}`} className="text-indigo-600 hover:underline">
          Open the original
        </Link>
      </p>
      {current ? (
        <DraftView draft={current} />
      ) : (
        <p className="text-sm text-slate-500">No draft yet. Auto flesh-out writes a first one.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {workshop ? (
          <>
            <button
              type="button"
              className={button}
              disabled={busy || !online}
              onClick={() => void fleshOut()}
            >
              {busy ? 'Thinking…' : drafts.length ? 'Flesh out again' : 'Auto flesh-out'}
            </button>
            <span className="text-xs text-slate-500">
              {online ? `One AI call, ${FLESH_OUT_COST_TEXT}.` : 'Fleshing out needs a connection.'}
            </span>
          </>
        ) : (
          <span className="text-sm text-slate-500">
            The Workshop needs Airhead&apos;s server (sign in).
          </span>
        )}
      </div>
      {message && (
        <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          {message}
        </p>
      )}
      <SessionPanel itemId={item.id} />
      {drafts.length > 1 && (
        <section aria-label="Versions" className="mt-6">
          <h3 className="mb-1 text-sm font-semibold">Versions</h3>
          <ul className="flex flex-wrap gap-1.5">
            {drafts.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  aria-pressed={d.id === current?.id}
                  onClick={() => setShown(d.id)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    d.id === current?.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800'
                  }`}
                >
                  Version {d.version}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
