import type { Scope } from '../../lib/calendar/occurrence';
import { Button } from '../../ui/Button';

const LABELS: Record<Scope, string> = {
  this: 'This event',
  following: 'This and following',
  all: 'All events',
};

/**
 * The standard question for a repeating event (Task 11.5): change, move or
 * delete this event, this and following, or all events.
 */
export default function RepeatChoice({
  question,
  onChoose,
  onCancel,
  allowThis = true,
  destructive = false,
}: {
  question: string;
  onChoose: (scope: Scope) => void;
  onCancel: () => void;
  /** False when the repeat itself changed: one event cannot have its own rule. */
  allowThis?: boolean;
  destructive?: boolean;
}) {
  const scopes: Scope[] = allowThis ? ['this', 'following', 'all'] : ['following', 'all'];
  return (
    <div role="group" aria-label={question} className="w-full space-y-2">
      <p className="text-footnote font-semibold">{question}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        {scopes.map((s) => (
          <Button
            key={s}
            variant={destructive ? 'destructive' : s === 'this' ? 'primary' : 'secondary'}
            onClick={() => onChoose(s)}
          >
            {LABELS[s]}
          </Button>
        ))}
      </div>
    </div>
  );
}
