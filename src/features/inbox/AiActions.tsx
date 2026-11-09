import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import { applyProposal, dismissAction, fixLink, undoAction } from '../../lib/db/aiActions';
import { useDb } from '../../lib/db/context';
import type { AiAction } from '../../lib/schemas/records';
import { Button } from '../../ui/Button';
import { buttonClasses } from '../../ui/buttonClasses';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';

const WEEK = 7 * 86_400_000;

function Quote({ a }: { a: AiAction }) {
  if (!a.quote) return null;
  return <p className="text-footnote break-words text-fg-muted italic">“{a.quote}”</p>;
}

/** What happened when an action ran ("Changed since…"), with a link to look at it. */
function Note({ a, text }: { a: AiAction; text?: string }) {
  if (!text) return null;
  return (
    <p role="status" className="mt-1 text-footnote text-fg-muted">
      {text}{' '}
      <Link to={fixLink(a)} className="font-medium text-accent underline">
        Open
      </Link>
    </p>
  );
}

const when = (at: string) =>
  new Date(at).toLocaleString('en-IE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

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
        <Section title="Needs your OK">
          <GroupedList label="Needs your OK">
            {asks.map((a) => {
              const choices = Array.isArray(a.payload.choices)
                ? (a.payload.choices as string[])
                : [];
              return (
                <GroupedListItem key={a.id}>
                  <p className="text-body font-medium break-words">{a.summary}</p>
                  <Quote a={a} />
                  {a.reason && <p className="text-footnote text-fg-muted">{a.reason}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {choices.length > 0 ? (
                      choices.map((id, n) => {
                        const at = choiceItems?.find((i) => i?.id === id)?.start_at;
                        return (
                          <Button key={id} size="sm" onClick={() => void apply(a, id)}>
                            {titleOf(id) ?? `Option ${n + 1}`}
                            {at ? ` · ${when(at)}` : ''}
                          </Button>
                        );
                      })
                    ) : a.after ? (
                      <Button size="sm" variant="primary" onClick={() => void apply(a)}>
                        Apply
                      </Button>
                    ) : (
                      <Link to={fixLink(a)} className={buttonClasses('primary', 'sm')}>
                        Fix
                      </Link>
                    )}
                    <Button
                      size="sm"
                      variant="plain"
                      onClick={() => void dismissAction(db, uid, a)}
                    >
                      Dismiss
                    </Button>
                  </div>
                  <Note a={a} text={notes[a.id]} />
                </GroupedListItem>
              );
            })}
          </GroupedList>
        </Section>
      )}

      {done.length > 0 && (
        <Section title="Done by AI">
          <GroupedList label="Done by AI">
            {done.map((a) => (
              <GroupedListItem key={a.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body break-words">{a.summary}</p>
                    <Quote a={a} />
                  </div>
                  <Button size="sm" aria-label={`Undo: ${a.summary}`} onClick={() => void undo(a)}>
                    Undo
                  </Button>
                </div>
                <Note a={a} text={notes[a.id]} />
              </GroupedListItem>
            ))}
          </GroupedList>
        </Section>
      )}
    </>
  );
}
