import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useAppLock } from '../../lib/applock/context';
import { TIMEOUT_CHOICES } from '../../lib/applock/lock';

const timeoutLabel = (m: number) =>
  m === 0 ? 'Immediately' : m === 60 ? 'After 1 hour' : `After ${m} minute${m === 1 ? '' : 's'}`;

export default function AppLockSettings() {
  const { services, user } = useAuth();
  const { config, enable, disable, setTimeoutMinutes } = useAppLock();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = config.enabled && !!config.credentialId;

  useEffect(() => {
    let alive = true;
    services.appLock.available().then(
      (a) => alive && setAvailable(a),
      () => alive && setAvailable(false),
    );
    return () => {
      alive = false;
    };
  }, [services.appLock]);

  async function toggle() {
    setError(null);
    if (on) return disable();
    setBusy(true);
    try {
      await enable(user?.email ?? 'Airhead');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on the app lock.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p id="app-lock-label" className="font-medium">
            App lock
          </p>
          <p className="text-sm text-slate-500">Ask for Face ID / Touch ID when Airhead opens.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="app-lock-label"
          disabled={busy || available === false || available === null}
          onClick={() => void toggle()}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
            on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
          }`}
        >
          <span
            className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${
              on ? 'left-5.5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {available === false && (
        <p className="text-sm text-slate-500">
          Face ID / Touch ID isn&apos;t available on this device.
        </p>
      )}

      {on && (
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Lock after</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            value={config.timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
          >
            {TIMEOUT_CHOICES.map((m) => (
              <option key={m} value={m}>
                {timeoutLabel(m)}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <p className="text-xs text-slate-500">
        The lock is a privacy screen, not encryption: it stops someone browsing Airhead on an
        unlocked device. If Face ID stops working, sign out and back in.
      </p>
    </div>
  );
}
