import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import type { AskOutcome } from '../../lib/auth/types';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import { useOnline } from '../../lib/useOnline';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { TextField } from '../../ui/TextField';

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
      <p className="mb-4 px-1 text-footnote text-fg-muted">
        Ask Airhead needs Airhead&apos;s server (sign in).
      </p>
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
    <section aria-label="Ask Airhead" className="mb-6 space-y-2">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="Question"
          hideLabel
          placeholder="Ask about your notes, meetings and ideas"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={!online || !question.trim()}
        >
          {busy ? 'Thinking…' : 'Ask'}
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-caption text-fg-muted">
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
            className="min-h-8 rounded-md border border-border bg-surface px-1 text-fg"
          >
            <option value="small">the quick model</option>
            <option value="large">the thorough model</option>
          </select>
        </label>
      </div>
      {result &&
        (result.ok ? (
          <Card className="text-body">
            <p className="whitespace-pre-wrap">{result.answer}</p>
            {result.sources.length > 0 && (
              <ul aria-label="Sources" className="mt-3 flex flex-wrap gap-2">
                {result.sources.map((s, i) => (
                  <li key={s.item_id}>
                    <Link
                      to={`/library/item/${s.item_id}`}
                      className="inline-flex min-h-8 items-center rounded-full bg-fill px-3 text-caption font-medium text-fg hover:brightness-95"
                    >
                      [{i + 1}] {s.title || '(untitled)'}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <p role="status" className="px-1 text-footnote text-warning">
            {result.message}
          </p>
        ))}
    </section>
  );
}
