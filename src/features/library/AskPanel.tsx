import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import type { AskOutcome } from '../../lib/auth/types';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import { useOnline } from '../../lib/useOnline';

/** Rough cost per question: ~2,000 tokens in, ~300 out. */
const COST = { small: '≈ €0.002', large: '≈ €0.01' } as const;

/**
 * Ask Airhead (Task 7.10): a question about everything saved, answered from
 * the closest passages with citations that open the source. Online only;
 * regular search works offline.
 */
export default function AskPanel() {
  const db = useDb();
  const { services, user } = useAuth();
  const online = useOnline();
  const userId = user?.id ?? '';
  const settings = useLiveQuery(() => db.settings.get(userId), [db, userId]);
  const model = settings?.data.ask_model === 'large' ? 'large' : 'small';
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskOutcome | null>(null);
  const ask = services.ask;

  if (!ask)
    return (
      <p className="text-sm text-slate-500">Ask Airhead needs Airhead&apos;s server (sign in).</p>
    );

  const submit = async () => {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    try {
      setResult(await ask.ask(q));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Ask Airhead" className="mb-6 space-y-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          aria-label="Question"
          placeholder="Ask about your notes, meetings and ideas"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={busy || !online || !question.trim()}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>
          {online
            ? `One AI call, ${COST[model]}.`
            : 'Ask Airhead needs a connection — search below works offline.'}
        </span>
        <label>
          Answer with{' '}
          <select
            value={model}
            onChange={(e) => void updateSettingsData(db, userId, { ask_model: e.target.value })}
            className="rounded border border-slate-300 bg-white px-1 dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="small">the quick model</option>
            <option value="large">the thorough model</option>
          </select>
        </label>
      </div>
      {result &&
        (result.ok ? (
          <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
            <p className="whitespace-pre-wrap">{result.answer}</p>
            {result.sources.length > 0 && (
              <ul aria-label="Sources" className="mt-2 flex flex-wrap gap-1.5">
                {result.sources.map((s, i) => (
                  <li key={s.item_id}>
                    <Link
                      to={`/library/item/${s.item_id}`}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200 dark:bg-slate-800"
                    >
                      [{i + 1}] {s.title || '(untitled)'}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
            {result.message}
          </p>
        ))}
    </section>
  );
}
