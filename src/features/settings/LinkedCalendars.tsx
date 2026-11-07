import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../lib/auth/context';
import type { CalendarOutcome } from '../../lib/auth/types';
import { useDb } from '../../lib/db/context';
import { addLinkedCalendar, LINKED_COLOURS, linkHost } from '../../lib/db/feeds';
import { softDelete, update } from '../../lib/db/repository';
import { useSync } from '../../lib/sync/context';
import { lastSyncedText } from '../sync/labels';

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
const small =
  'rounded-md px-2 py-1 text-xs font-semibold hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800';

/** Settings → Linked calendars (Task 4.9): someone's secret iCal link, read-only in Airhead. */
export default function LinkedCalendars() {
  const db = useDb();
  const { user, services } = useAuth();
  const sync = useSync();
  const feeds = useLiveQuery(
    async () =>
      (await db.feeds.where('kind').equals('linked_in').toArray()).filter((f) => !f.deleted_at),
    [db],
  );
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [colour, setColour] = useState(LINKED_COLOURS[0] ?? '#0f766e');
  const [check, setCheck] = useState<CalendarOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const calendars = services.calendars;

  if (!calendars) {
    return (
      <p className="text-sm text-slate-500">
        Needs a server: linked calendars are fetched by Airhead’s server every 30 minutes.
      </p>
    );
  }

  async function onCheck() {
    if (!calendars || !url.trim()) return;
    setBusy(true);
    const res = await calendars.validate(url.trim());
    setCheck(res);
    if (res.ok && res.name && !name) setName(res.name);
    setBusy(false);
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!calendars || !check?.ok) return;
    setBusy(true);
    const feed = await addLinkedCalendar(db, user?.id ?? '', { url, name, colour });
    setUrl('');
    setName('');
    setCheck(null);
    // Push the new row first, then ask the server to read it straight away.
    await sync.syncNow();
    await calendars.refresh(feed.id);
    await sync.syncNow();
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Paste a calendar’s secret iCal link (for example your partner’s shared calendar). Its events
        show in Airhead read-only and refresh every 30 minutes. Airhead only reads it; it never
        learns from or acts on what’s inside.
      </p>
      {feeds && feeds.length > 0 && (
        <ul
          aria-label="Linked calendars"
          className="divide-y divide-slate-100 dark:divide-slate-800"
        >
          {feeds.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: f.colour ?? LINKED_COLOURS[0] }}
                  />
                  {f.name || 'Linked calendar'}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {linkHost(f.url)} ·{' '}
                  {f.last_error ? (
                    <span className="text-red-600">{f.last_error}</span>
                  ) : f.last_fetched_at ? (
                    `updated ${lastSyncedText(f.last_fetched_at).replace(/^Today/, 'today')}`
                  ) : (
                    'waiting for the first fetch'
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  role="switch"
                  aria-checked={f.enabled}
                  aria-label={`Show ${f.name || 'linked calendar'}`}
                  className={small}
                  onClick={() => void update(db, 'feeds', f.id, { enabled: !f.enabled })}
                >
                  {f.enabled ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  className={small}
                  disabled={busy}
                  onClick={() => void calendars.refresh(f.id).then(() => sync.syncNow())}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className={`${small} text-red-600`}
                  onClick={() => void softDelete(db, 'feeds', f.id)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        aria-label="Add a linked calendar"
        onSubmit={(e) => void onAdd(e)}
        className="space-y-2"
      >
        <label className="block text-sm">
          Calendar link
          <input
            className={field}
            type="url"
            inputMode="url"
            placeholder="webcal://… or https://….ics"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setCheck(null);
            }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700"
            disabled={!url.trim() || busy}
            onClick={() => void onCheck()}
          >
            Check link
          </button>
          {check && (
            <span
              role="status"
              className={`text-sm ${check.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}
            >
              {check.message}
            </span>
          )}
        </div>
        {check?.ok && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Name
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <fieldset className="flex items-center gap-1">
              <legend className="sr-only">Colour</legend>
              {LINKED_COLOURS.map((c) => (
                <label key={c} className="cursor-pointer">
                  <input
                    type="radio"
                    name="linked-colour"
                    className="sr-only"
                    aria-label={`Colour ${c}`}
                    checked={colour === c}
                    onChange={() => setColour(c)}
                  />
                  <span
                    aria-hidden="true"
                    className={`block size-6 rounded-full ${colour === c ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white' : ''}`}
                    style={{ background: c }}
                  />
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Add calendar
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
