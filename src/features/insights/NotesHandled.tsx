import { useLiveQuery } from 'dexie-react-hooks';
import { notesHandled } from '../../lib/ai/notesHandled';
import { WINDOW_DAYS } from '../../lib/ai/measures';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { sendCaptureToWorkshop } from '../../lib/db/workshop';
import { Button } from '../../ui/Button';
import { GroupedList, GroupedListItem } from '../../ui/GroupedList';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card border border-border/60 bg-surface p-4">
      <p className="text-caption text-fg-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-caption text-fg-muted">{note}</p>}
    </div>
  );
}

/**
 * Insights → Notes handled (Task 12.5): captures accounted for, questions open,
 * answered and dismissed, and the correction rate. Anything not acted on is a
 * number that opens into the list.
 */
export default function NotesHandled() {
  const db = useDb();
  const { user } = useAuth();
  const data = useLiveQuery(
    async () => ({
      captures: await db.captures.toArray(),
      items: await db.items.toArray(),
      actions: await db.ai_actions.toArray(),
      followUps: await db.follow_ups.toArray(),
      corrections: await db.corrections.toArray(),
    }),
    [db],
  );
  if (!data) return null;
  const n = notesHandled(data);
  const q = n.questions;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label={`Notes handled (last ${WINDOW_DAYS} days)`}
          value={`${n.handled} of ${n.total}`}
          note={
            n.waiting
              ? `${n.waiting} waiting for sorting. Every note gets an item, an action, a question or a Workshop note.`
              : 'Every note gets an item, an action, a question or a Workshop note.'
          }
        />
        <Tile
          label="Questions"
          value={`${q.open} open`}
          note={`${q.answered} answered, ${q.dismissed} dismissed`}
        />
        <Tile
          label="Correction rate"
          value={`${Math.round(n.correctionRate * 100)}%`}
          note={`${n.corrections} corrections for ${n.itemsSorted} sorted items, including dismissed questions.`}
        />
      </div>
      {n.notActedOn.length === 0 ? (
        <p className="px-1 text-footnote text-fg-muted">Not acted on: 0. Nothing was dropped.</p>
      ) : (
        <details className="px-1">
          <summary className="cursor-pointer text-footnote font-medium text-accent">
            Not acted on: {n.notActedOn.length}
          </summary>
          <GroupedList label="Not acted on" className="mt-2">
            {n.notActedOn.map((c) => (
              <GroupedListItem key={c.id}>
                <p className="text-body break-words whitespace-pre-wrap">{c.text ?? c.url}</p>
                <p className="text-footnote text-fg-muted">
                  {c.status === 'failed' ? 'Sorting could not read it.' : 'Kept as written.'}
                </p>
                {typeof c.payload.workshop_item_id !== 'string' && (
                  <Button
                    size="sm"
                    variant="plain"
                    className="-ml-3"
                    onClick={() => void sendCaptureToWorkshop(db, user?.id ?? '', c.id)}
                  >
                    Send to Workshop
                  </Button>
                )}
              </GroupedListItem>
            ))}
          </GroupedList>
        </details>
      )}
    </div>
  );
}
