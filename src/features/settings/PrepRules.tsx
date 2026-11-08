import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import { beforeText, readWorkSettings } from '../../lib/work/settings';

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
      <p className="text-sm text-slate-500">
        None yet. Write a note like “once the barber is booked, remind me to bring €20 cash”.
      </p>
    );

  return (
    <ul aria-label="Prep reminders" className="space-y-2">
      {rules.map((r) => (
        <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">{r.reminder}</span>{' '}
            <span className="text-slate-500">
              · {beforeText(r.minutes_before)} {r.match.map((w) => `“${w}”`).join(' or ')} events
            </span>
          </span>
          <button
            type="button"
            aria-label={`Remove prep reminder: ${r.reminder}`}
            className="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            onClick={() =>
              void updateSettingsData(db, uid, {
                work: { ...raw, prep_rules: rules.filter((x) => x.id !== r.id) },
              })
            }
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
