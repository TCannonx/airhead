import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useAppLock } from '../../lib/applock/context';
import { TIMEOUT_CHOICES } from '../../lib/applock/lock';
import { Toggle } from '../../ui/Toggle';
import { FIELD_INLINE } from '../../ui/fieldParts';

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
      <Toggle
        label="App lock"
        hint="Ask for Face ID / Touch ID when Airhead opens."
        checked={on}
        disabled={busy || available === false || available === null}
        onChange={() => void toggle()}
      />

      {available === false && (
        <p className="text-footnote text-fg-muted">
          Face ID / Touch ID isn&apos;t available on this device.
        </p>
      )}

      {on && (
        <label className="flex min-h-11 items-center justify-between gap-4 text-body">
          <span>Lock after</span>
          <select
            className={FIELD_INLINE}
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
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}

      <p className="text-caption text-fg-muted">
        The lock is a privacy screen, not encryption: it stops someone browsing Airhead on an
        unlocked device. If Face ID stops working, sign out and back in.
      </p>
    </div>
  );
}
