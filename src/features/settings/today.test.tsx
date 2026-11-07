import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { Services } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import TodaySettings from './TodaySettings';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderIt(services: Services) {
  render(
    <MemoryRouter>
      <AuthProvider services={services}>
        <DataProvider userId={U}>
          <TodaySettings />
        </DataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db().delete();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings → Today (Task 5.9)', () => {
  it('saves the brief time and the day window for slots', async () => {
    const user = userEvent.setup();
    renderIt(localServices());
    const form = await screen.findByRole('form', { name: 'Today settings' });
    const time = within(form).getByLabelText('Morning brief at');
    await user.clear(time);
    await user.type(time, '06:45');
    const start = within(form).getByLabelText('Day starts');
    await user.clear(start);
    await user.type(start, '09:00');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      const d = db();
      const s = await d.settings.get(U);
      d.close();
      expect(s?.data).toMatchObject({
        notifications: { brief_time: '06:45', daily_cap: 8 },
        today: { window_start: '09:00', window_end: '21:00' },
      });
    });
  });

  it('refuses a day that ends before it starts', async () => {
    const user = userEvent.setup();
    renderIt(localServices());
    const form = await screen.findByRole('form', { name: 'Today settings' });
    const end = within(form).getByLabelText('Day ends');
    await user.clear(end);
    await user.type(end, '07:00');
    expect(within(form).getByRole('alert')).toHaveTextContent('The day must end after it starts.');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Regenerate shows its cost, runs once, and is disabled offline or without a server', async () => {
    const regenerate = vi.fn(() => Promise.resolve({ ok: true, message: 'Your brief is ready.' }));
    const user = userEvent.setup();
    renderIt({ ...localServices(), briefs: { regenerate } });
    const btn = await screen.findByRole('button', {
      name: /Regenerate today’s brief \(≈ €0\.01\)/,
    });
    await user.click(btn);
    expect(await screen.findByRole('status')).toHaveTextContent('Your brief is ready.');
    expect(regenerate).toHaveBeenCalledTimes(1);

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Regenerate/ })).toBeDisabled());
    expect(screen.getByText(/You’re offline/)).toBeInTheDocument();
  });

  it('local mode: no server, no Regenerate', async () => {
    renderIt(localServices());
    expect(await screen.findByRole('button', { name: /Regenerate/ })).toBeDisabled();
    expect(screen.getByText('Needs Airhead’s server.')).toBeInTheDocument();
  });
});
