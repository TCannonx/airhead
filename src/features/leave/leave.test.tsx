import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { createCapture } from '../../lib/db/captures';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { saveLeave } from '../../lib/db/leave';
import { updateSettingsData } from '../../lib/db/settings';
import { DEFAULT_WORK_SETTINGS } from '../../lib/work/settings';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

beforeEach(async () => {
  // Only Date is faked, so Dexie's timers and promises run normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T09:00:00Z'));
  localStorage.clear();
  await db().delete();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('leave on Today and the Work screen (Task 4.6)', () => {
  it('Today shows the counter and books a captured "AL 14–18 July" as planned leave', async () => {
    const d = db();
    await createCapture(d, U, { text: 'AL 14–18 July' });
    d.close();
    const user = userEvent.setup();
    renderAt('/today');

    expect(await screen.findByText('Leave: 21 days left')).toBeInTheDocument();
    const cards = await screen.findByRole('list', { name: 'Leave to book' });
    expect(within(cards).getByText('Annual leave: 14 Jul – 18 Jul 2026')).toBeInTheDocument();
    await user.click(within(cards).getByRole('button', { name: 'Book as planned' }));

    // Tue 14 to Sat 18 July: four working days.
    expect(await screen.findByText('Leave: 17 days left')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Leave to book' })).not.toBeInTheDocument(),
    );
    const x = db();
    const [b] = await x.leave_bookings.toArray();
    x.close();
    expect(b).toMatchObject({
      start_date: '2026-07-14',
      end_date: '2026-07-18',
      status: 'planned',
      days: 4,
    });
  });

  it('the Work screen books leave, shows the cost live and lists the booking', async () => {
    const user = userEvent.setup();
    renderAt('/work');
    const balance = await screen.findByLabelText('Leave balance');
    expect(balance).toHaveTextContent(/^21 days left/);

    await user.click(screen.getByRole('button', { name: 'Book leave' }));
    const form = screen.getByRole('form', { name: 'Book leave' });
    await user.clear(within(form).getByLabelText('From'));
    await user.type(within(form).getByLabelText('From'), '2026-08-03');
    await user.clear(within(form).getByLabelText('To'));
    await user.type(within(form).getByLabelText('To'), '2026-08-07');
    // 3 August is a bank holiday: 4 days.
    expect(
      within(form).getByText('Uses 4 days of leave · 17 days left after this'),
    ).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText('Status'), 'approved');
    await user.click(within(form).getByRole('button', { name: 'Book leave' }));

    const list = await screen.findByRole('list', { name: 'This leave year' });
    expect(within(list).getByText('3 Aug – 7 Aug 2026')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Leave balance')).toHaveTextContent(/^17 days left/),
    );
  });

  it('warns about days that would be lost at the end of the leave year', async () => {
    vi.setSystemTime(new Date('2026-09-15T09:00:00Z'));
    const d = db();
    await updateSettingsData(d, U, { work: { ...DEFAULT_WORK_SETTINGS, entitlement: 20 } });
    await saveLeave(
      d,
      U,
      {
        start_date: '2026-07-13',
        end_date: '2026-07-17',
        start_half: false,
        end_half: false,
        leave_type: 'annual',
        status: 'taken',
        share_us: false,
      },
      { ...DEFAULT_WORK_SETTINGS, entitlement: 20 },
    );
    d.close();
    renderAt('/today');
    expect(await screen.findByText('Leave: 15 days left')).toBeInTheDocument();
    expect(
      screen.getByText(
        '10 days would be lost on 30 November unless booked (only 5 days carry over).',
      ),
    ).toBeInTheDocument();
  });
});
