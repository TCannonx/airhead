import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { Page } from '../../app/Page';
import AppLockSettings from '../applock/AppLockSettings';
import { lastSyncedText } from '../sync/labels';
import { useSync } from '../../lib/sync/context';
import { readSyncLog } from '../../lib/sync/syncLog';
import ExportSettings from './ExportSettings';
import CheckupPanel from './CheckupPanel';
import MemorySettings from './MemorySettings';
import NotificationSettings from './NotificationSettings';
import CaptureTokens from './CaptureTokens';
import LinkedCalendars from './LinkedCalendars';
import ScoutSettingsPanel from './ScoutSettings';
import SharingSettings from './SharingSettings';
import TodaySettings from './TodaySettings';
import PrepRules from './PrepRules';
import WorkSettings from './WorkSettings';
import { loadLatestVersion } from '../../lib/pwa/loadLatest';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { ListRow } from '../../ui/ListRow';

/** A settings block whose content is a whole panel (not yet rows). */
function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <Card>{children}</Card>
    </Section>
  );
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' });

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
      <Section
        title="Account"
        footer={
          signOutError ? (
            <p role="alert" className="text-danger">
              {signOutError}
            </p>
          ) : undefined
        }
      >
        <GroupedList>
          {local ? (
            <GroupedListItem>
              <p className="text-footnote text-fg-muted">
                Local mode: no server is configured, so nothing leaves this device.
              </p>
            </GroupedListItem>
          ) : (
            <ListRow
              title={<span className="font-medium">{user?.email}</span>}
              subtitle="Signed in as"
              trailing={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    services.auth
                      .signOut()
                      .catch((e: unknown) =>
                        setSignOutError(e instanceof Error ? e.message : String(e)),
                      )
                  }
                >
                  Sign out
                </Button>
              }
            />
          )}
        </GroupedList>
      </Section>

      <PanelSection title="Security">
        <AppLockSettings />
      </PanelSection>

      <Section title="Devices">
        {!devices && <p className="px-4 text-footnote text-fg-muted">Loading…</p>}
        {devices && (
          <GroupedList label="Devices">
            {devices.map((d) => (
              <ListRow
                key={d.id}
                title={<span className="font-medium">{d.name}</span>}
                trailing={d.id === deviceId ? <Chip tone="accent">This device</Chip> : undefined}
              />
            ))}
          </GroupedList>
        )}
      </Section>

      <PanelSection title="Notifications">
        <NotificationSettings />
      </PanelSection>

      <Section title="Sync">
        {sync.status ? (
          <GroupedList>
            <GroupedListItem>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-footnote text-fg-muted">Last successful sync</p>
                  <p className="font-medium">{lastSyncedText(sync.status.lastSyncedAt)}</p>
                  {sync.status.message && (
                    <p className="text-footnote text-fg-muted">{sync.status.message}</p>
                  )}
                  {sync.status.state === 'syncing' && sync.status.since && (
                    <p className="text-caption text-fg-muted">
                      Syncing since {timeOf(sync.status.since)}
                      {sync.status.stage ? `: ${sync.status.stage}` : ''}
                    </p>
                  )}
                  {sync.status.state === 'error' && sync.status.detail && (
                    <p className="text-caption break-words text-fg-muted">{sync.status.detail}</p>
                  )}
                </div>
                {/* Never disabled: it restarts a run that is taking too long. */}
                <Button size="sm" onClick={() => void sync.syncNow({ force: true })}>
                  Sync now
                </Button>
              </div>
            </GroupedListItem>
            <GroupedListItem>
              <details>
                <summary className="cursor-pointer text-footnote text-fg-muted">Sync log</summary>
                <ol className="mt-2 space-y-0.5 font-mono text-caption break-words text-fg-muted">
                  {readSyncLog(15)
                    .reverse()
                    .map((x, i) => (
                      <li key={`${x.t}-${i}`}>
                        {timeOf(x.t)} {x.e}
                        {x.d ? ` · ${x.d}` : ''}
                      </li>
                    ))}
                </ol>
              </details>
            </GroupedListItem>
            <ListRow
              title={<span className="text-footnote text-fg-muted">Version {__APP_BUILD__}</span>}
              trailing={
                <Button variant="plain" size="sm" onClick={() => void loadLatestVersion()}>
                  Load latest version
                </Button>
              }
            />
          </GroupedList>
        ) : (
          <Card>
            <p className="text-footnote text-fg-muted">
              Not syncing: no server is configured, so everything stays on this device.
            </p>
          </Card>
        )}
      </Section>

      <PanelSection title="Today">
        <TodaySettings />
      </PanelSection>

      <PanelSection title="Work">
        <WorkSettings />
      </PanelSection>

      <PanelSection title="Prep reminders">
        <PrepRules />
      </PanelSection>

      <PanelSection title="Sharing">
        <SharingSettings />
      </PanelSection>

      <PanelSection title="Capture from anywhere">
        <CaptureTokens />
      </PanelSection>

      <PanelSection title="Linked calendars">
        <LinkedCalendars />
      </PanelSection>

      <PanelSection title="Scout">
        <ScoutSettingsPanel />
      </PanelSection>

      <Section title="Memory">
        <Card>
          <MemorySettings />
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="mb-2 text-footnote font-medium">Check-up</h3>
            <CheckupPanel />
          </div>
        </Card>
      </Section>

      <PanelSection title="Your data">
        <ExportSettings />
      </PanelSection>

      <Section title="About">
        <GroupedList>
          <ListRow
            icon="info"
            title="Design kit"
            subtitle="Every shared component, light and dark"
            to="/ui"
          />
        </GroupedList>
      </Section>
    </Page>
  );
}
