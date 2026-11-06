import { useEffect, useState } from 'react';
import { Page } from '../../app/Page';
import AppLockSettings from '../applock/AppLockSettings';
import { useAuth } from '../../lib/auth/context';
import type { DeviceRow } from '../../lib/auth/types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { user, services, deviceId } = useAuth();
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    services.devices.list().then(
      (rows) => alive && setDevices(rows),
      (e: unknown) => alive && setDevicesError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [services.devices]);

  const local = services.auth.mode === 'local';

  return (
    <Page title="Settings">
      <Section title="Account">
        {local ? (
          <p className="text-sm text-slate-500">
            Local mode: no server is configured, so nothing leaves this device.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Signed in as</p>
              <p className="font-medium">{user?.email}</p>
            </div>
            <button
              type="button"
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
              onClick={() =>
                services.auth
                  .signOut()
                  .catch((e: unknown) =>
                    setSignOutError(e instanceof Error ? e.message : String(e)),
                  )
              }
            >
              Sign out
            </button>
          </div>
        )}
        {signOutError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {signOutError}
          </p>
        )}
      </Section>

      <Section title="Security">
        <AppLockSettings />
      </Section>

      <Section title="Devices">
        {devicesError && <p className="text-sm text-slate-500">{devicesError}</p>}
        {!devices && !devicesError && <p className="text-sm text-slate-500">Loading…</p>}
        {devices && (
          <ul aria-label="Devices" className="divide-y divide-slate-200 dark:divide-slate-800">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
              >
                <span className="font-medium">{d.name}</span>
                {d.id === deviceId && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    This device
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
