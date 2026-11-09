import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import type { WorkshopTurnOutcome } from '../../lib/auth/types';
import { useDb } from '../../lib/db/context';
import { sessionFor } from '../../lib/db/workshop';
import { draftSchema, workshopSessionSchema } from '../../lib/schemas/records';
import { useOnline } from '../../lib/useOnline';
import { clearPending, getPending, setPending } from '../../lib/workshop/pending';
import { Button } from '../../ui/Button';
import { Section } from '../../ui/GroupedList';
import { TextArea } from '../../ui/TextArea';

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
    <Section title="Work on it together" label="Work on it together">
      <div className="space-y-3">
        {turns.length === 0 && !data.pending ? (
          <Button variant="primary" disabled={busy || !online} onClick={() => void send(null)}>
            {busy ? 'Thinking…' : 'Start'}
          </Button>
        ) : (
          <>
            <ol className="space-y-2 text-body">
              {turns.map((t, i) => (
                <li
                  key={i}
                  className={`rounded-card px-3.5 py-2.5 whitespace-pre-wrap ${
                    t.role === 'me'
                      ? 'ml-10 bg-accent-soft text-on-accent-soft'
                      : 'mr-10 border border-border/60 bg-surface'
                  }`}
                >
                  {t.text}
                </li>
              ))}
              {data.pending && (
                <li className="ml-10 rounded-card bg-accent-soft px-3.5 py-2.5 whitespace-pre-wrap text-on-accent-soft opacity-70">
                  {data.pending.text}
                  <span className="block text-caption text-fg-muted">
                    Waiting to send when you’re online
                  </span>
                </li>
              )}
            </ol>
            {!data.pending && (
              <div className="flex items-end gap-2">
                <TextArea
                  label="Your answer"
                  hideLabel
                  className="min-w-0 flex-1"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={busy || !answer.trim()}
                  onClick={() => void submit()}
                >
                  {busy ? 'Thinking…' : online ? 'Send' : 'Save for later'}
                </Button>
              </div>
            )}
          </>
        )}
        {message && (
          <p role="status" className="text-footnote text-warning">
            {message}
          </p>
        )}
      </div>
    </Section>
  );
}
