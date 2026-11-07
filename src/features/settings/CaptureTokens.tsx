import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import type { CaptureTokenRow } from '../../lib/capture/tokens';
import ShortcutsGuide from './ShortcutsGuide';

const field =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
const button =
  'rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : 'never';

/**
 * Settings → Capture from anywhere (Task 7.1): tokens for iOS Shortcuts.
 * A new token is shown once (only its hash is kept); revoking one stops it.
 */
export default function CaptureTokens() {
  const { services } = useAuth();
  const tokens = services.captureTokens;
  const [rows, setRows] = useState<CaptureTokenRow[] | null>(null);
  const [label, setLabel] = useState('iPhone');
  const [fresh, setFresh] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!tokens) return;
    tokens.list().then(setRows, (e: Error) => setMessage(e.message));
  }, [tokens]);
  useEffect(load, [load]);

  if (!tokens)
    return (
      <p className="text-sm text-slate-500">
        Capturing from Shortcuts needs Airhead&apos;s server (sign in).
      </p>
    );

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-500">
        A token lets an iOS Shortcut save captures to Airhead. Each device or Shortcut gets its own;
        revoke one if a phone is lost.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Name
          <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button
          type="button"
          className={button}
          disabled={busy || !label.trim()}
          onClick={() =>
            void act(async () => {
              setFresh(await tokens.create(label.trim()));
            })
          }
        >
          Create token
        </button>
      </div>
      {fresh && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
        >
          <p className="mb-1 font-semibold">Copy this token now — it won&apos;t be shown again.</p>
          <code className="block break-all">{fresh}</code>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={button}
              onClick={() => void navigator.clipboard?.writeText(fresh)}
            >
              Copy
            </button>
            <button type="button" className={button} onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-slate-500">No tokens yet.</p>}
      <ul aria-label="Capture tokens" className="divide-y divide-slate-200 dark:divide-slate-800">
        {rows?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="font-medium">{t.label}</p>
              <p className="text-xs text-slate-500">
                {t.revoked_at
                  ? `Revoked ${when(t.revoked_at)}`
                  : `Last used: ${when(t.last_used_at)}`}
              </p>
            </div>
            {!t.revoked_at && (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void act(() => tokens.revoke(t.id))}
              >
                Revoke {t.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className="text-amber-700 dark:text-amber-400">
          {message}
        </p>
      )}
      <ShortcutsGuide />
    </div>
  );
}
