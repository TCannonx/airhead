import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Page } from '../../app/Page';
import AppLockSettings from '../applock/AppLockSettings';
import { lastSyncedText } from '../sync/labels';
import { useSync } from '../../lib/sync/context';
import ExportSettings from './ExportSettings';
import CheckupPanel from './CheckupPanel';
import MemorySettings from './MemorySettings';
import NotificationSettings from './NotificationSettings';
import CaptureTokens from './CaptureTokens';
import LinkedCalendars from './LinkedCalendars';
import ScoutSettingsPanel from './ScoutSettings';
import SharingSettings from './SharingSettings';
import TodaySettings from './TodaySettings';
import WorkSettings from './WorkSettings';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';

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
  const db = useDb();
  const sync = useSync();
  const devices = useLiveQuery(
    () => db.devices.filter((d) => !d.deleted_at).sortBy('created_at'),
    [db],
  );
  const [signOutError, setSignOutError] = useState<string | null>(null);

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
        {!devices && <p className="text-sm text-slate-500">Loading…</p>}
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

      <Section title="Notifications">
        <NotificationSettings />
      </Section>

      <Section title="Sync">
        {sync.status ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Last successful sync</p>
              <p className="font-medium">{lastSyncedText(sync.status.lastSyncedAt)}</p>
              {sync.status.message && (
                <p className="text-sm text-slate-500">{sync.status.message}</p>
              )}
            </div>
            <button
              type="button"
              disabled={sync.status.state === 'syncing'}
              onClick={() => void sync.syncNow()}
              className="shrink-0 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              Sync now
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Not syncing: no server is configured, so everything stays on this device.
          </p>
        )}
      </Section>

      <Section title="Today">
        <TodaySettings />
      </Section>

      <Section title="Work">
        <WorkSettings />
      </Section>

      <Section title="Sharing">
        <SharingSettings />
      </Section>

      <Section title="Capture from anywhere">
        <CaptureTokens />
      </Section>

      <Section title="Linked calendars">
        <LinkedCalendars />
      </Section>

      <Section title="Scout">
        <ScoutSettingsPanel />
      </Section>

      <Section title="Memory">
        <MemorySettings />
        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <h3 className="mb-2 text-sm font-medium">Check-up</h3>
          <CheckupPanel />
        </div>
      </Section>

      <Section title="Your data">
        <ExportSettings />
      </Section>
    </Page>
  );
}
