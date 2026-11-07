import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import type { Platform } from '../../lib/device';
import {
  PermissionDenied,
  pushSupport,
  saveSubscription,
  subscribe,
  unsubscribe,
} from '../../lib/push/push';
import { useSync } from '../../lib/sync/context';
import { update } from '../../lib/db/repository';
import NotificationPrefs from './NotificationPrefs';

const small =
  'rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800';
const primary =
  'rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50';

/** Settings → Notifications (Task 4.11): turn on push, choose the device, send a test. */
export default function NotificationSettings({ standalone }: { standalone?: boolean }) {
  const db = useDb();
  const { deviceId, services } = useAuth();
  const sync = useSync();
  const devices = useLiveQuery(
    async () => (await db.devices.toArray()).filter((d) => !d.deleted_at),
    [db],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const push = services.push;
  if (!devices) return null;
  const me = devices.find((d) => d.id === deviceId);
  const receiver = devices.find((d) => d.receives_notifications);
  const platform = (me?.platform ?? 'other') as Platform;
  const support = pushSupport(platform, standalone);

  if (!push) {
    return (
      <p className="text-sm text-slate-500">
        Needs a server: notifications are sent by Airhead’s server.
      </p>
    );
  }

  async function turnOn() {
    if (!push || !deviceId) return;
    setBusy(true);
    setMessage(null);
    try {
      const key = await push.publicKey();
      if (!key) {
        setMessage('Notifications aren’t set up on the server yet.');
        return;
      }
      const sub = await subscribe(key);
      await saveSubscription(db, deviceId, platform, sub);
      await sync.syncNow();
      setMessage('Notifications are on for this device.');
    } catch (e) {
      setMessage(
        e instanceof PermissionDenied
          ? 'Notifications are blocked for Airhead. Allow them in your browser or phone settings, then try again.'
          : 'Couldn’t turn on notifications here. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!push || !deviceId) return;
    setBusy(true);
    await sync.syncNow();
    const res = await push.sendTest(deviceId);
    setMessage(res.message);
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Reminders, the evening review and other nudges go to one device (your iPhone, normally).
        Other devices stay quiet but in sync.
      </p>
      {support === 'needs_install' && (
        <div role="note" className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
          On iPhone and iPad, notifications work only when Airhead is on your Home Screen: tap{' '}
          <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open Airhead from the
          Home Screen and come back here.
        </div>
      )}
      {support === 'unsupported' && (
        <p className="text-sm text-slate-500">This browser can’t show notifications.</p>
      )}
      <p className="text-sm">
        {receiver
          ? me?.receives_notifications
            ? 'This device gets notifications.'
            : `Notifications go to ${receiver.name}.`
          : 'Notifications are off on all devices.'}
      </p>
      {devices.some((d) => d.push_subscription) && (
        <ul aria-label="Devices that get notifications" className="space-y-1">
          {devices
            .filter((d) => d.push_subscription)
            .map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {d.name}
                  {d.id === deviceId ? ' (this device)' : ''}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={d.receives_notifications}
                  aria-label={`Notifications on ${d.name}`}
                  className={small}
                  onClick={() =>
                    void update(db, 'devices', d.id, {
                      receives_notifications: !d.receives_notifications,
                    })
                  }
                >
                  {d.receives_notifications ? 'On' : 'Off'}
                </button>
              </li>
            ))}
        </ul>
      )}
      {support === 'supported' && (
        <div className="flex flex-wrap gap-2">
          {!me?.push_subscription ? (
            <button type="button" className={primary} disabled={busy} onClick={() => void turnOn()}>
              Turn on notifications
            </button>
          ) : (
            <>
              <button type="button" className={small} disabled={busy} onClick={() => void test()}>
                Send test notification
              </button>
              <button
                type="button"
                className={`${small} text-red-600`}
                onClick={() => void unsubscribe(db, deviceId ?? '')}
              >
                Turn off on this device
              </button>
            </>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          {message}
        </p>
      )}
      <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <NotificationPrefs />
      </div>
    </div>
  );
}
