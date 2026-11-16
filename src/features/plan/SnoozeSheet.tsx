import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { snoozeChoices, whenLabel } from '../../lib/plan/plan';
import { Button } from '../../ui/Button';
import { FIELD_INLINE } from '../../ui/fieldParts';
import { Sheet } from '../../ui/Sheet';

/** A Date as the value of an <input type="datetime-local"> (device time). */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * What a tapped notification opens (Task 13.8): snooze it (in an hour, this
 * evening, tomorrow morning, or a time you pick), mark it done, or say it was
 * not needed. No reliance on notification action buttons.
 */
export function SnoozeSheet({ nudgeId, onClose }: { nudgeId: string; onClose: () => void }) {
  const db = useDb();
  const { user, services } = useAuth();
  const nudge = useLiveQuery(() => db.nudges.get(nudgeId), [db, nudgeId]);
  const settings = useLiveQuery(() => db.settings.get(user?.id ?? ''), [db, user?.id]);
  const [now] = useState(() => new Date());
  const [pick, setPick] = useState(() => localInput(new Date(now.getTime() + 2 * 3_600_000)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const service = services.nudges;

  const answer = (outcome: 'acted' | 'dismissed' | 'snoozed', to?: Date) => {
    if (!service) return;
    setBusy(true);
    setMessage(null);
    void service
      .respond(nudgeId, outcome, to?.toISOString())
      .then((r) => (r.ok ? onClose() : setMessage(r.message)))
      .finally(() => setBusy(false));
  };
  const picked = new Date(pick);
  const pickValid = !Number.isNaN(picked.getTime()) && picked > now;

  return (
    <Sheet open onClose={onClose} title={nudge?.title || 'Reminder'}>
      <div className="space-y-4">
        {nudge?.reason && <p className="text-footnote text-fg-muted">{nudge.reason}</p>}
        {!service && (
          <p className="text-footnote text-fg-muted">Snoozing needs Airhead’s server.</p>
        )}
        <div className="grid gap-2" role="group" aria-label="Snooze">
          {snoozeChoices(now, settings).map((c) => (
            <Button
              key={c.label}
              disabled={!service || busy}
              onClick={() => answer('snoozed', c.at)}
            >
              {c.label} ({whenLabel(c.at.toISOString(), now)})
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            aria-label="Pick a time"
            className={FIELD_INLINE}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          />
          <Button
            disabled={!service || busy || !pickValid}
            onClick={() => answer('snoozed', picked)}
          >
            Snooze to this time
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
          <Button variant="primary" disabled={!service || busy} onClick={() => answer('acted')}>
            Done
          </Button>
          <Button disabled={!service || busy} onClick={() => answer('dismissed')}>
            Not needed
          </Button>
        </div>
        {message && (
          <p role="alert" className="text-footnote text-danger">
            {message}
          </p>
        )}
      </div>
    </Sheet>
  );
}
