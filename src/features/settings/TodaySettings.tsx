import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import { readNotifSettings } from '../../lib/notifications/settings';
import type { SettingsRow } from '../../lib/schemas/records';

const field =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Rough cost of one brief at the default Sonnet prices: ~3,000 tokens in, ~600 out. */
export const BRIEF_COST_TEXT = '≈ €0.01';

function readToday(settings: SettingsRow | undefined) {
  const t = (settings?.data.today ?? {}) as { window_start?: unknown; window_end?: unknown };
  return {
    window_start:
      typeof t.window_start === 'string' && HHMM.test(t.window_start) ? t.window_start : '08:00',
    window_end:
      typeof t.window_end === 'string' && HHMM.test(t.window_end) ? t.window_end : '21:00',
  };
}

function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function TodayForm({ settings, userId }: { settings: SettingsRow | undefined; userId: string }) {
  const db = useDb();
  const notif = readNotifSettings(settings);
  const initial = { brief_time: notif.brief_time, ...readToday(settings) };
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const valid =
    HHMM.test(f.brief_time) &&
    HHMM.test(f.window_start) &&
    HHMM.test(f.window_end) &&
    f.window_end > f.window_start;
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (k: keyof typeof f, v: string) => {
    setSaved(false);
    setF((p) => ({ ...p, [k]: v }));
  };

  return (
    <form
      aria-label="Today settings"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void updateSettingsData(db, userId, {
          notifications: { ...notif, brief_time: f.brief_time },
          today: { window_start: f.window_start, window_end: f.window_end },
        }).then(() => setSaved(true));
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        Morning brief at
        <input
          type="time"
          className={field}
          value={f.brief_time}
          onChange={(e) => set('brief_time', e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Suggest Top 3 times between
        <input
          type="time"
          aria-label="Day starts"
          className={field}
          value={f.window_start}
          onChange={(e) => set('window_start', e.target.value)}
        />
        and
        <input
          type="time"
          aria-label="Day ends"
          className={field}
          value={f.window_end}
          onChange={(e) => set('window_end', e.target.value)}
        />
      </div>
      <p className="text-xs text-slate-500">
        To turn the brief off, switch off “Morning brief and round-up” in Notifications.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || !valid}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Save
        </button>
        {!valid && (
          <span role="alert" className="text-sm text-red-600">
            The day must end after it starts.
          </span>
        )}
        {saved && !dirty && <span className="text-sm text-slate-500">Saved</span>}
      </div>
    </form>
  );
}

/** Settings → Today (Task 5.9): brief time, the day window for slots, and Regenerate. */
export default function TodaySettings() {
  const db = useDb();
  const { user, services } = useAuth();
  const userId = user?.id ?? '';
  const settings = useLiveQuery(() => db.settings.get(userId), [db, userId], null);
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (settings === null) return null;
  const briefs = services.briefs;

  return (
    <div className="space-y-5">
      <TodayForm key={JSON.stringify(settings?.data ?? {})} settings={settings} userId={userId} />
      <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <button
          type="button"
          disabled={!briefs || !online || busy}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700"
          onClick={() => {
            if (!briefs) return;
            setBusy(true);
            setMessage(null);
            void briefs
              .regenerate()
              .then((r) => setMessage(r.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Writing…' : `Regenerate today’s brief (${BRIEF_COST_TEXT})`}
        </button>
        <p className="mt-1 text-xs text-slate-500">
          {!briefs
            ? 'Needs Airhead’s server.'
            : !online
              ? 'You’re offline: the brief is written on the server.'
              : 'One AI call, counted in Insights → AI usage.'}
        </p>
        {message && (
          <p role="status" className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
