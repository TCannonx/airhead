import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { workDayId } from '../../lib/db/workDays';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string, width = 390) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
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

const override = async () => {
  const d = db();
  const row = await d.work_days.get(workDayId(U, '2026-07-14'));
  d.close();
  return row;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-14T08:00:00Z')); // Tuesday: Office by default
  localStorage.clear();
  await db().delete();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('work location (Task 4.7)', () => {
  it('Today shows the usual location and changes it in one tap', async () => {
    const user = userEvent.setup();
    renderAt('/today');
    const chip = await screen.findByRole('button', { name: 'Work location: Office. Change' });
    await user.click(chip);
    const choices = screen.getByRole('group', { name: 'Where are you working?' });
    await user.click(within(choices).getByRole('button', { name: 'WFH' }));

    expect(
      await screen.findByRole('button', { name: 'Work location: WFH. Change' }),
    ).toBeInTheDocument();
    expect(await override()).toMatchObject({
      date: '2026-07-14',
      location: 'wfh',
      deleted_at: null,
    });

    // Back to the usual place clears the override.
    await user.click(screen.getByRole('button', { name: 'Work location: WFH. Change' }));
    await user.click(screen.getByRole('button', { name: 'Office (usual)' }));
    await screen.findByRole('button', { name: 'Work location: Office. Change' });
    await waitFor(async () => expect((await override())?.deleted_at).toBeTruthy());
  });

  it('the desktop side panel has the same control', async () => {
    renderAt('/library', 1440);
    const panel = await screen.findByRole('complementary', { name: 'Side panel' });
    expect(
      await within(panel).findByRole('button', { name: 'Work location: Office. Change' }),
    ).toBeInTheDocument();
  });

  it('Insights shows days per location by week and month', async () => {
    renderAt('/insights', 1440);
    const week = await screen.findByRole('table', { name: 'By week' });
    // Week of 13 July so far: Mon and Tue in the Office.
    const row = within(week).getByRole('row', { name: /w\/c 13 Jul/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['–', '2', '–']);
    // Columns used in the last 8 weeks (1 June was a bank holiday, so Off appears).
    expect(
      within(week)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Period', 'WFH', 'Office', 'Off']);
    expect(screen.getByRole('table', { name: 'By month' })).toBeInTheDocument();
  });
});
