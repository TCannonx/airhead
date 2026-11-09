import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import { beforeText, readWorkSettings } from '../../lib/work/settings';
import { Button } from '../../ui/Button';

/**
 * Standing prep reminders ("before barber or haircut events: Bring €20 cash"),
 * usually added by AI sorting from a note. Removing one cancels its reminders.
 */
export default function PrepRules() {
  const db = useDb();
  const { user } = useAuth();
  const uid = user?.id ?? '';
  const settings = useLiveQuery(() => db.settings.get(uid), [db, uid]);
  const raw = (settings?.data.work ?? {}) as Record<string, unknown>;
  const rules = readWorkSettings(settings).prep_rules;

  if (!rules.length)
    return (
      <p className="text-footnote text-fg-muted">
        None yet. Write a note like “once the barber is booked, remind me to bring €20 cash”.
      </p>
    );

  return (
    <ul aria-label="Prep reminders" className="space-y-2">
      {rules.map((r) => (
        <li key={r.id} className="flex items-start justify-between gap-3 text-footnote">
          <span>
            <span className="font-medium">{r.reminder}</span>{' '}
            <span className="text-fg-muted">
              · {beforeText(r.minutes_before)} {r.match.map((w) => `“${w}”`).join(' or ')} events
            </span>
          </span>
          <Button
            size="sm"
            aria-label={`Remove prep reminder: ${r.reminder}`}
            onClick={() =>
              void updateSettingsData(db, uid, {
                work: { ...raw, prep_rules: rules.filter((x) => x.id !== r.id) },
              })
            }
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}
