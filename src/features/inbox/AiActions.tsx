import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import { applyProposal, dismissAction, fixLink, undoAction } from '../../lib/db/aiActions';
import { useDb } from '../../lib/db/context';
import type { AiAction } from '../../lib/schemas/records';

const WEEK = 7 * 86_400_000;
const chip =
  'rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800';
const primary =
  'rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700';

function Heading({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
      {children}
    </h2>
  );
}

function Quote({ a }: { a: AiAction }) {
  if (!a.quote) return null;
  return <p className="text-sm text-slate-500">“{a.quote}”</p>;
}

/**
 * What AI sorting did for you this week (each with Undo) and what it would like
 * an OK for (Apply, pick one, Fix or Dismiss). Phase 10.
 */
export default function AiActions() {
  const db = useDb();
  const { user } = useAuth();
  const uid = user?.id ?? '';
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Applied ones from the last week; proposals however old.
  const rows = useLiveQuery(() => {
    const since = new Date(Date.now() - WEEK).toISOString();
    return db.ai_actions
      .filter(
        (a) =>
          !a.deleted_at &&
          (a.status === 'proposed' || (a.status === 'applied' && a.created_at >= since)),
      )
      .toArray();
  }, [db]);
  const choiceIds = (rows ?? [])
    .filter((a) => a.status === 'proposed')
    .flatMap((a) => (Array.isArray(a.payload.choices) ? (a.payload.choices as string[]) : []));
  const choiceKey = choiceIds.join(',');
  const choiceItems = useLiveQuery(
    () => (choiceKey ? db.items.bulkGet(choiceKey.split(',')) : []),
    [db, choiceKey],
  );
  if (!rows) return null;

  const done = rows
    .filter((a) => a.status === 'applied')
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .slice(0, 10);
  const asks = rows
    .filter((a) => a.status === 'proposed')
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  if (!done.length && !asks.length) return null;

  const titleOf = (id: string) => choiceItems?.find((i) => i?.id === id)?.title;
  const note = (id: string, text: string) => setNotes((n) => ({ ...n, [id]: text }));

  async function undo(a: AiAction) {
    const r = await undoAction(db, uid, a);
    if (r === 'changed') note(a.id, 'Changed since, so it was left as it is.');
    if (r === 'missing') note(a.id, 'It’s no longer there.');
  }
  async function apply(a: AiAction, choice?: string) {
    const r = await applyProposal(db, uid, a, choice);
    if (r === 'changed') note(a.id, 'Changed since; check it by hand.');
    if (r === 'needs_fix') note(a.id, 'Needs a fix by hand.');
  }

  return (
    <>
      {asks.length > 0 && (
        <section className="mb-8">
          <Heading>Needs your OK</Heading>
          <ul aria-label="Needs your OK" className="space-y-2">
            {asks.map((a) => {
              const choices = Array.isArray(a.payload.choices)
                ? (a.payload.choices as string[])
                : [];
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
                >
                  <p className="font-medium">{a.summary}</p>
                  <Quote a={a} />
                  {a.reason && (
                    <p className="text-sm text-slate-700 dark:text-slate-300">{a.reason}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {choices.length > 0 ? (
                      choices.map((id, n) => (
                        <button
                          key={id}
                          type="button"
                          className={chip}
                          onClick={() => void apply(a, id)}
                        >
                          {titleOf(id) ?? `Option ${n + 1}`}
                          {(() => {
                            const at = choiceItems?.find((i) => i?.id === id)?.start_at;
                            return at
                              ? ` · ${new Date(at).toLocaleString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                              : '';
                          })()}
                        </button>
                      ))
                    ) : a.after ? (
                      <button type="button" className={primary} onClick={() => void apply(a)}>
                        Apply
                      </button>
                    ) : (
                      <Link to={fixLink(a)} className={primary}>
                        Fix
                      </Link>
                    )}
                    <button
                      type="button"
                      className={chip}
                      onClick={() => void dismissAction(db, a)}
                    >
                      Dismiss
                    </button>
                  </div>
                  {notes[a.id] && (
                    <p role="status" className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {notes[a.id]}{' '}
                      <Link to={fixLink(a)} className="text-indigo-600 underline">
                        Open
                      </Link>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section className="mb-8">
          <Heading>Done by AI</Heading>
          <ul aria-label="Done by AI" className="space-y-2">
            {done.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{a.summary}</p>
                    <Quote a={a} />
                  </div>
                  <button
                    type="button"
                    aria-label={`Undo: ${a.summary}`}
                    className={chip}
                    onClick={() => void undo(a)}
                  >
                    Undo
                  </button>
                </div>
                {notes[a.id] && (
                  <p role="status" className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {notes[a.id]}{' '}
                    <Link to={fixLink(a)} className="text-indigo-600 underline">
                      Open
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
