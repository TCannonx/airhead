import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import {
  NUDGE_LABELS,
  NUDGE_TYPES,
  notifSettingsSchema,
  readNotifSettings,
  type NotifSettings,
} from '../../lib/notifications/settings';

const field =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
const REMINDER_DEFAULTS = [0, 5, 10, 15, 30, 60, 120];

function PrefsForm({
  initial,
  onSave,
  saved,
  onEdit,
}: {
  initial: NotifSettings;
  onSave: (n: NotifSettings) => Promise<void>;
  saved: boolean;
  onEdit: () => void;
}) {
  const [n, setN] = useState(initial);
  const set = <K extends keyof NotifSettings>(k: K, v: NotifSettings[K]) => {
    onEdit();
    setN((p) => ({ ...p, [k]: v }));
  };
  const valid = notifSettingsSchema.safeParse(n).success;
  const dirty = JSON.stringify(n) !== JSON.stringify(initial);

  return (
    <form
      aria-label="Notification preferences"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void onSave(n);
      }}
    >
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-medium">Send me</legend>
        {NUDGE_TYPES.map((t) => (
          <label key={t} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={n.types[t]}
              onChange={(e) => set('types', { ...n.types, [t]: e.target.checked })}
            />
            {NUDGE_LABELS[t]}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Quiet hours</legend>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          From
          <input
            type="time"
            aria-label="Quiet hours start"
            className={field}
            value={n.quiet_start}
            onChange={(e) => set('quiet_start', e.target.value)}
          />
          to
          <input
            type="time"
            aria-label="Quiet hours end"
            className={field}
            value={n.quiet_end}
            onChange={(e) => set('quiet_end', e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={n.quiet_allows_events}
            onChange={(e) => set('quiet_allows_events', e.target.checked)}
          />
          Event reminders still come through
        </label>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          Most notifications a day
          <input
            type="number"
            min="1"
            max="50"
            className={`${field} ml-2 w-20`}
            value={n.daily_cap}
            onChange={(e) => set('daily_cap', Number(e.target.value))}
          />
        </label>
        <label className="text-sm">
          Event reminders by default
          <select
            className={`${field} ml-2`}
            value={n.event_reminder_minutes}
            onChange={(e) => set('event_reminder_minutes', Number(e.target.value))}
          >
            {REMINDER_DEFAULTS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'At the start' : m < 60 ? `${m} min before` : `${m / 60} h before`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {(
          [
            ['evening_review_time', 'Evening review at'],
            ['checklist_time', 'Checklist at'],
            ['morning_time', 'Morning nudges at'],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              type="time"
              className={`${field} ml-2`}
              value={n[k]}
              onChange={(e) => set(k, e.target.value)}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        More than the daily limit are bundled into one summary. Times are a minute or two late at
        most.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || !valid}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Save notification settings
        </button>
        {saved && !dirty && <span className="text-sm text-slate-500">Saved</span>}
      </div>
    </form>
  );
}

/** Settings → Notifications preferences (Task 4.15). */
export default function NotificationPrefs() {
  const db = useDb();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const settings = useLiveQuery(() => db.settings.get(userId), [db, userId], null);
  const [saved, setSaved] = useState(false);
  if (settings === null) return null;
  const prefs = readNotifSettings(settings);
  return (
    <PrefsForm
      key={JSON.stringify(prefs)}
      initial={prefs}
      saved={saved}
      onEdit={() => setSaved(false)}
      onSave={async (n) => {
        await updateSettingsData(db, userId, { notifications: n });
        setSaved(true);
      }}
    />
  );
}
