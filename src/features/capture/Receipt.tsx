import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../lib/auth/context';
import { undoAction } from '../../lib/db/aiActions';
import { useDb } from '../../lib/db/context';
import { buildReceipt, type ReceiptLine } from '../../lib/db/receipts';
import type { Capture } from '../../lib/schemas/records';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';

function Line({ line }: { line: ReceiptLine }) {
  const db = useDb();
  const { user } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const to = 'to' in line ? line.to : undefined;
  return (
    <li className="py-1">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-footnote break-words">
          {to ? (
            <Link to={to} className="text-accent underline">
              {line.text}
            </Link>
          ) : (
            line.text
          )}
        </p>
        {line.kind === 'applied' && (
          <Button
            size="sm"
            variant="plain"
            className="-my-1 shrink-0"
            aria-label={`Undo: ${line.text}`}
            onClick={() =>
              void undoAction(db, user?.id ?? '', line.action).then((r) => {
                if (r === 'changed') setNote('Changed since, so it was left as it is.');
                if (r === 'missing') setNote('It’s no longer there.');
              })
            }
          >
            Undo
          </Button>
        )}
      </div>
      {line.quote && (
        <p className="text-caption break-words text-fg-muted italic">from “{line.quote}”</p>
      )}
      {note && (
        <p role="status" className="text-caption text-fg-muted">
          {note}
        </p>
      )}
    </li>
  );
}

/**
 * "What Airhead did" with one capture (Task 12.3): a disclosure under the
 * capture, one line per outcome with the words it came from.
 */
export function Receipt({ capture, className }: { capture: Capture; className?: string }) {
  const db = useDb();
  const rows = useLiveQuery(async () => {
    const [items, actions, followUps] = await Promise.all([
      db.items.where('capture_id').equals(capture.id).toArray(),
      db.ai_actions.where('capture_id').equals(capture.id).toArray(),
      db.follow_ups.where('capture_id').equals(capture.id).toArray(),
    ]);
    return { items, actions, followUps };
  }, [db, capture.id]);
  if (!rows) return null;
  const receipt = buildReceipt(capture, rows);
  return (
    <details className={cx('mt-1', className)}>
      <summary className="cursor-pointer text-footnote font-medium text-accent">
        What Airhead did
      </summary>
      {receipt.state === 'waiting' ? (
        <p className="py-1 text-footnote text-fg-muted">{receipt.text}</p>
      ) : (
        <ul aria-label="What Airhead did" className="mt-1">
          {receipt.lines.map((l, n) => (
            <Line key={n} line={l} />
          ))}
        </ul>
      )}
    </details>
  );
}
