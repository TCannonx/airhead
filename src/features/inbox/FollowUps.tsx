import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import {
  answerFollowUp,
  dismissFollowUp,
  followUpSource,
  openFollowUps,
} from '../../lib/db/followUps';
import type { FollowUp } from '../../lib/schemas/records';
import { Button } from '../../ui/Button';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { TextField } from '../../ui/TextField';

const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One question: quick answers, a text box, Send and Dismiss (Task 12.2). */
function Question({
  f,
  source,
  onDone,
}: {
  f: FollowUp;
  source: string | null;
  onDone: (text: string) => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const uid = user?.id ?? '';
  const [text, setText] = useState('');

  async function answer(value: string) {
    if (!value.trim()) return;
    const saved = await answerFollowUp(db, uid, f.id, value);
    if (saved) onDone('Thanks. Airhead will use that the next time it sorts.');
  }
  async function dismiss() {
    await dismissFollowUp(db, uid, f.id);
    onDone('Dismissed. Airhead will ask less like that.');
  }

  return (
    <GroupedListItem>
      <p className="text-body font-medium break-words">{f.question}</p>
      {source && (
        <p className="text-footnote break-words text-fg-muted italic">From “{short(source)}”</p>
      )}
      {f.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Quick answers">
          {f.options.map((o) => (
            <Button key={o} size="sm" onClick={() => void answer(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void answer(text);
        }}
      >
        <TextField
          label={`Answer: ${f.question}`}
          hideLabel
          placeholder="Your answer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>
          Send
        </Button>
        <Button
          size="sm"
          variant="plain"
          aria-label={`Dismiss: ${f.question}`}
          onClick={() => void dismiss()}
        >
          Dismiss
        </Button>
      </form>
    </GroupedListItem>
  );
}

/**
 * Open questions as a list (Task 12.2). In the Inbox they show the note they
 * came from; on an item page they are about that item, so no source is shown.
 */
export function FollowUpList({
  itemId,
  title = 'Questions for you',
  showSource = true,
}: {
  itemId?: string;
  title?: string;
  showSource?: boolean;
}) {
  const db = useDb();
  const [status, setStatus] = useState('');
  const rows = useLiveQuery(async () => {
    const open = await openFollowUps(db, itemId);
    return Promise.all(
      open.map(async (f) => ({ f, source: showSource ? await followUpSource(db, f) : null })),
    );
  }, [db, itemId, showSource]);
  if (!rows || (rows.length === 0 && !status)) return null;
  return (
    <Section title={title}>
      {rows.length > 0 && (
        <GroupedList label={title}>
          {rows.map(({ f, source }) => (
            <Question key={f.id} f={f} source={source} onDone={setStatus} />
          ))}
        </GroupedList>
      )}
      <p className="mt-2 px-4 text-footnote text-fg-muted" role="status" aria-live="polite">
        {status}
      </p>
    </Section>
  );
}
