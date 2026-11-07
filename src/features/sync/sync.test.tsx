import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SyncContext } from '../../lib/sync/context';
import type { SyncStatus } from '../../lib/sync/types';
import { lastSyncedText, syncLabel } from './labels';
import { SyncIndicator } from './SyncIndicator';

const s = (over: Partial<SyncStatus>): SyncStatus => ({
  state: 'idle',
  pending: 0,
  lastSyncedAt: null,
  message: null,
  ...over,
});

describe('syncLabel', () => {
  it.each([
    [s({}), 'Synced'],
    [s({ pending: 3 }), '3 waiting'],
    [s({ state: 'syncing', pending: 2 }), 'Syncing…'],
    [s({ state: 'offline', pending: 0 }), 'Offline'],
    [s({ state: 'offline', pending: 1 }), 'Offline · 1 waiting'],
    [s({ state: 'error', pending: 4 }), '4 waiting · will retry'],
    [s({ state: 'error', pending: 0 }), 'Not synced yet · will retry'],
  ])('%o → %s', (status, label) => {
    expect(syncLabel(status)).toBe(label);
  });
});

describe('lastSyncedText', () => {
  const now = new Date('2026-11-07T10:42:00Z');
  it('says never, today or the date', () => {
    expect(lastSyncedText(null, now)).toBe('Never');
    expect(lastSyncedText('2026-11-07T10:41:30Z', now)).toBe('Today at 10:41');
    expect(lastSyncedText('2026-11-05T08:05:00Z', now)).toBe('Thu 5 Nov at 08:05');
  });
});

describe('SyncIndicator', () => {
  const renderWith = (status: SyncStatus | null) =>
    render(
      <SyncContext value={{ status, syncNow: async () => {} }}>
        <SyncIndicator />
      </SyncContext>,
    );

  it('shows the label and explains it on hover/long-press', () => {
    renderWith(
      s({ state: 'offline', pending: 3, message: 'Offline. Changes are saved on this device.' }),
    );
    const el = screen.getByText('Offline · 3 waiting');
    expect(el.closest('[title]')).toHaveAttribute(
      'title',
      'Offline. Changes are saved on this device.',
    );
  });

  it('is hidden in local mode (no server)', () => {
    const { container } = renderWith(null);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Settings → Sync', () => {
  it('shows the last successful sync and a Sync now button', async () => {
    const { default: SettingsPage } = await import('../settings/SettingsPage');
    const { AuthProvider } = await import('../../lib/auth/AuthProvider');
    const { LOCAL_USER_ID, localServices } = await import('../../lib/auth/localAuth');
    const { DataProvider } = await import('../../lib/db/DataProvider');
    const { AppLockProvider } = await import('../applock/AppLockProvider');
    const syncNow = vi.fn(async () => {});
    render(
      <AuthProvider services={localServices()}>
        <DataProvider userId={LOCAL_USER_ID}>
          <AppLockProvider>
            <SyncContext value={{ status: s({ lastSyncedAt: new Date().toISOString() }), syncNow }}>
              <SettingsPage />
            </SyncContext>
          </AppLockProvider>
        </DataProvider>
      </AuthProvider>,
    );
    expect(await screen.findByText(/^Today at \d\d:\d\d$/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(syncNow).toHaveBeenCalledOnce();
  });
});
