import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import type { WorkshopTurnOutcome } from '../../lib/auth/types';
import { useDb } from '../../lib/db/context';
import { sessionFor } from '../../lib/db/workshop';
import { draftSchema, workshopSessionSchema } from '../../lib/schemas/records';
import { useOnline } from '../../lib/useOnline';
import { clearPending, getPending, setPending } from '../../lib/workshop/pending';

const button =
  'rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700';

/**
 * "Work on it together" (Task 7.7): Airhead asks two or three questions at a
 * time and updates the draft (a new version) after each answer. An answer
 * typed offline waits on this device and is sent when back online.
 */
export default function SessionPanel({ itemId }: { itemId: string }) {
  const db = useDb();
  const { services } = useAuth();
  const online = useOnline();
  const workshop = services.workshop;
  const data = useLiveQuery(
    async () => ({ session: await sessionFor(db, itemId), pending: await getPending(db, itemId) }),
    [db, itemId],
  );
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sending = useRef(false);

  const apply = async (res: WorkshopTurnOutcome) => {
    if (!res.ok) {
      setMessage(res.message);
      return false;
    }
    const draft = draftSchema.safeParse(res.draft);
    const session = workshopSessionSchema.safeParse(res.session);
    // Show them now; the next sync brings the same rows.
    if (draft.success) await db.drafts.put(draft.data);
    if (session.success) await db.workshop_sessions.put(session.data);
    return true;
  };

  const send = async (text: string | null) => {
    if (!workshop?.turn || sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (await apply(await workshop.turn(itemId, text))) await clearPending(db, itemId);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  // Back online with an answer waiting: send it.
  const pendingText = data?.pending?.text ?? null;
  useEffect(() => {
    if (online && pendingText) void send(pendingText);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send is recreated each render
  }, [online, pendingText]);

  if (!workshop?.turn || !data) return null;
  const turns = data.session?.turns ?? [];

  const submit = async () => {
    const text = answer.trim();
    if (!text) return;
    setAnswer('');
    if (!online) {
      await setPending(db, itemId, text);
      return;
    }
    await send(text);
  };

  return (
    <section aria-label="Work on it together" className="mt-6 space-y-3">
      <h3 className="text-sm font-semibold">Work on it together</h3>
      {turns.length === 0 && !data.pending ? (
        <button
          type="button"
          className={button}
          disabled={busy || !online}
          onClick={() => void send(null)}
        >
          {busy ? 'Thinking…' : 'Start'}
        </button>
      ) : (
        <>
          <ol className="space-y-2 text-sm">
            {turns.map((t, i) => (
              <li
                key={i}
                className={`whitespace-pre-wrap rounded-lg p-2 ${
                  t.role === 'me'
                    ? 'ml-8 bg-indigo-50 dark:bg-indigo-950'
                    : 'mr-8 bg-slate-100 dark:bg-slate-800'
                }`}
              >
                {t.text}
              </li>
            ))}
            {data.pending && (
              <li className="ml-8 whitespace-pre-wrap rounded-lg bg-indigo-50 p-2 opacity-70 dark:bg-indigo-950">
                {data.pending.text}
                <span className="block text-xs text-slate-500">
                  Waiting to send when you’re online
                </span>
              </li>
            )}
          </ol>
          {!data.pending && (
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1 text-sm">
                <span className="sr-only">Your answer</span>
                <textarea
                  aria-label="Your answer"
                  rows={3}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
                />
              </label>
              <button
                type="button"
                className={button}
                disabled={busy || !answer.trim()}
                onClick={() => void submit()}
              >
                {busy ? 'Thinking…' : online ? 'Send' : 'Save for later'}
              </button>
            </div>
          )}
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {message}
        </p>
      )}
    </section>
  );
}
