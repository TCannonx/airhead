import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord } from '../../lib/db/repository';
import { readScoutSettings } from '../../lib/scout/settings';
import { scoutRunSchema, suggestionSchema } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';
import ScoutSettingsPanel from './ScoutSettings';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Scout data and settings (Task 8.9)', () => {
  it('schemas accept server rows; settings fall back to defaults', () => {
    const base = { ...baseRecord(U), server_updated_at: '2026-07-15T10:00:00+00:00' };
    expect(
      scoutRunSchema.safeParse({
        ...base,
        trigger: 'manual',
        queries: ['gigs in Dublin'],
        searches: 1,
        cards: 3,
        cost_eur: '0.0200',
        status: 'ok',
      }).success,
    ).toBe(true);
    expect(
      suggestionSchema.safeParse({
        ...base,
        run_id: null,
        kind: 'web',
        title: 'Tickets on sale',
        body: null,
        source_url: 'https://example.com',
        proposed: { type: 'task', title: 'Buy tickets' },
        status: 'open',
      }).success,
    ).toBe(true);
    expect(readScoutSettings(null)).toEqual({ enabled: true, city: '', max_searches: 3 });
    expect(
      readScoutSettings({ ...baseRecord(U), data: { scout: { max_searches: 9 } } }).max_searches,
    ).toBe(3);
  });

  it('Settings → Scout saves the city and search cap and shows the last run’s queries', async () => {
    const d = db();
    await d.scout_runs.put({
      ...baseRecord(U),
      trigger: 'weekly',
      queries: ['football fixtures Dublin', 'gigs in Dublin this month'],
      searches: 2,
      cards: 4,
      cost_eur: 0.03,
      status: 'ok',
    });
    d.close();
    render(
      <AuthProvider services={localServices()}>
        <DataProvider userId={U}>
          <AppLockProvider>
            <ScoutSettingsPanel />
          </AppLockProvider>
        </DataProvider>
      </AuthProvider>,
    );
    const user = userEvent.setup();
    expect(await screen.findByText('gigs in Dublin this month')).toBeInTheDocument();
    expect(screen.getByText(/4 ideas, 2 searches/)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('e.g. Dublin'), 'Galway');
    await user.tab();
    await user.selectOptions(screen.getByLabelText(/Web searches per run/), '1');
    await waitFor(async () => {
      const d2 = db();
      const s = await d2.settings.get(U);
      d2.close();
      expect(s?.data.scout).toEqual({ enabled: true, city: 'Galway', max_searches: 1 });
    });
  });
});
