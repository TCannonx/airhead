import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { euro } from '../../lib/ai/usage';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import {
  archiveItem,
  condense,
  deleteProposal,
  keepItem,
  mergeFacts,
  proposalState,
  retireFact,
  type Proposal,
} from '../../lib/db/tidy';
import { readReview } from '../../lib/review/review';
import { useOnline } from '../../lib/useOnline';

const btn =
  'rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700';
const STATE_LABEL = {
  kept: 'Kept',
  archived: 'Archived',
  deleted: 'In the Trash',
  condensed: 'Condensed',
  gone: 'Gone',
} as const;
const VERB = { keep: 'Keep', archive: 'Archive', delete: 'Delete', condense: 'Condense' } as const;

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <ul className="list-disc pl-5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Insights → This week (Task 8.4): the latest weekly review, the Tidy-up card
 * (every proposal waits for a tap) and the memory card.
 */
export default function WeeklyReview() {
  const db = useDb();
  const { services, user, deviceId } = useAuth();
  const online = useOnline();
  const data = useLiveQuery(async () => {
    const reviews = await db.reviews.toArray();
    const latest = reviews
      .filter((r) => !r.deleted_at)
      .sort((a, b) => b.week_start.localeCompare(a.week_start))[0];
    if (!latest) return { review: null, items: new Map(), captures: new Map(), facts: new Map() };
    const review = readReview(latest);
    const itemIds = review.tidy.filter((t) => t.kind === 'item').map((t) => t.id);
    const capIds = review.tidy.filter((t) => t.kind === 'capture').map((t) => t.id);
    const factIds = review.facts.flatMap((f) => f.ids);
    const [items, captures, facts] = await Promise.all([
      db.items.bulkGet(itemIds),
      db.captures.bulkGet(capIds),
      db.memory_facts.bulkGet(factIds),
    ]);
    return {
      review,
      items: new Map(itemIds.map((id, i) => [id, items[i]])),
      captures: new Map(capIds.map((id, i) => [id, captures[i]])),
      facts: new Map(factIds.map((id, i) => [id, facts[i]])),
    };
  }, [db]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reviews = services.reviews;

  const runNow = async () => {
    if (!reviews) return;
    setBusy(true);
    setMessage(null);
    try {
      setMessage((await reviews.run()).message);
    } finally {
      setBusy(false);
    }
  };

  const runButton = reviews && (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      <button
        type="button"
        className={btn}
        disabled={busy || !online}
        onClick={() => void runNow()}
      >
        {busy ? 'Reviewing…' : 'Run the weekly review now'}
      </button>
      <span>{online ? 'One AI call, ≈ €0.03.' : 'Needs a connection.'}</span>
    </div>
  );

  if (!data) return null;
  const { review } = data;
  if (!review)
    return (
      <div className="space-y-2 text-sm">
        <p className="text-slate-500">
          The first weekly review arrives on your review day (Sunday evening by default).
        </p>
        {runButton}
        {message && <p role="status">{message}</p>}
      </div>
    );

  const stateOf = (p: Proposal) =>
    proposalState(p, p.kind === 'item' ? data.items.get(p.id) : data.captures.get(p.id));
  const open = review.tidy.filter((p) => stateOf(p) === 'open');
  const groups = new Map<number, Proposal[]>();
  for (const p of open)
    if (p.proposal === 'condense' && p.group !== null)
      groups.set(p.group, [...(groups.get(p.group) ?? []), p]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const apply = (p: Proposal, what: Proposal['proposal']) =>
    act(() =>
      what === 'keep'
        ? keepItem(db, p)
        : what === 'archive'
          ? archiveItem(db, p)
          : deleteProposal(db, p),
    );

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-slate-500">
        Week of {review.week_start}
        {review.status === 'fallback' && ' · numbers only (the AI part didn’t run)'}
        {' · '}AI this week: {euro(review.ai.cost_eur)} over {review.ai.calls} calls
      </p>
      <List title="Themes" items={review.themes} />
      <List title="Wins" items={review.wins} />
      <List title="What slipped" items={review.slipped} />
      <List title="Suggestions" items={review.suggestions} />

      {(review.tidy.length > 0 || review.auto_done.length > 0) && (
        <section
          aria-label="Tidy-up"
          className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
        >
          <h3 className="mb-2 font-semibold">Tidy-up</h3>
          {review.auto_done.length > 0 && (
            <p className="mb-2 text-xs text-slate-500">
              Tidied for you: {review.auto_done.length} old or duplicate{' '}
              {review.auto_done.length === 1 ? 'item' : 'items'} moved to the{' '}
              <Link to="/library/trash" className="underline">
                Trash
              </Link>{' '}
              (kept for 30 days).
            </p>
          )}
          <ul className="space-y-2">
            {review.tidy.map((p) => {
              const st = stateOf(p);
              return (
                <li
                  key={`${p.kind}:${p.id}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{p.title || '(untitled)'}</span>
                    <span className="block text-xs text-slate-500">
                      {VERB[p.proposal]}: {p.reason}
                    </span>
                  </span>
                  {st !== 'open' ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400">
                      {STATE_LABEL[st]}
                    </span>
                  ) : p.proposal === 'condense' ? (
                    <span className="text-xs text-slate-500">In group {p.group}</span>
                  ) : (
                    <span className="flex gap-1.5">
                      {p.proposal !== 'keep' && (
                        <button
                          type="button"
                          className={btn}
                          disabled={busy}
                          onClick={() => void apply(p, p.proposal)}
                        >
                          {VERB[p.proposal]} {p.title}
                        </button>
                      )}
                      <button
                        type="button"
                        className={btn}
                        disabled={busy}
                        onClick={() => void apply(p, 'keep')}
                      >
                        Keep {p.title}
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {[...groups.entries()].map(([g, members]) =>
            members.length < 2 ? null : (
              <button
                key={g}
                type="button"
                className={`${btn} mt-2`}
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    condense(
                      db,
                      user?.id ?? '',
                      deviceId ?? '',
                      members.map((m) => m.id),
                      `${members[0]?.title ?? 'Notes'} (condensed)`,
                    ),
                  )
                }
              >
                Condense {members.length} into one note
              </button>
            ),
          )}
        </section>
      )}

      {review.facts.length > 0 && (
        <section
          aria-label="Memory"
          className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
        >
          <h3 className="mb-2 font-semibold">Memory</h3>
          <ul className="space-y-2">
            {review.facts.map((f, i) => {
              const facts = f.ids
                .map((id) => data.facts.get(id))
                .filter((x) => !!x && !x.deleted_at);
              const done =
                f.action === 'retire'
                  ? facts.every((x) => x?.status === 'archived')
                  : facts.length <= 1 && facts[0]?.text === f.text;
              return (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    {f.action === 'merge'
                      ? `Merge into “${f.text}”`
                      : `Retire “${facts[0]?.text ?? ''}”`}
                    {f.action === 'merge' && (
                      <span className="block text-xs text-slate-500">
                        {facts.map((x) => x?.text).join(' · ')}
                      </span>
                    )}
                  </span>
                  {done || facts.length === 0 ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400">Done</span>
                  ) : (
                    <button
                      type="button"
                      className={btn}
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          f.action === 'merge'
                            ? mergeFacts(db, f.ids, f.text ?? '')
                            : retireFact(db, f.ids[0] ?? ''),
                        )
                      }
                    >
                      {f.action === 'merge' ? 'Merge' : 'Retire'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {runButton}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
