import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import type { LeaveSuggestRequest, LeaveService } from '../../lib/auth/types';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { newItem, save } from '../../lib/db/repository';
import { leaveBridges } from '../../lib/leave/suggest';
import { DEFAULT_WORK_SETTINGS } from '../../lib/work/settings';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string, leave?: LeaveService) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={{ ...localServices(), leave }}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-04-20T09:00:00Z'));
  localStorage.clear();
  await db().delete();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => vi.useRealTimers());

describe('holiday suggestions (Task 8.8)', () => {
  it('bridges come from local data and skip days with events', () => {
    const base = {
      work: DEFAULT_WORK_SETTINGS,
      bookings: [],
      external: [],
      today: '2026-04-20',
      weeks: 8,
    };
    const all = leaveBridges({ ...base, events: [] });
    expect(all.map((b) => b.leave[0])).toEqual(
      expect.arrayContaining(['2026-05-01', '2026-05-05', '2026-05-29', '2026-06-02']),
    );
    const dentist = newItem(U, {
      type: 'event',
      title: 'Dentist',
      start_at: '2026-05-05T09:00:00.000Z',
    });
    expect(
      leaveBridges({ ...base, events: [dentist] }).some((b) => b.leave.includes('2026-05-05')),
    ).toBe(false);
  });

  it('Suggest leave lists bridges offline; Book opens the leave sheet prefilled', async () => {
    renderAt('/work');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Suggest leave' }));
    expect(await screen.findByText('Good bridges in the next six months')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Book Fri, 1 May' }));
    await waitFor(() => expect(screen.getByLabelText(/^From/)).toHaveValue('2026-05-01'));
  });

  it('Ask Airhead to pick sends the candidates and shows the reasons', async () => {
    const d = db();
    await save(
      d,
      'items',
      newItem(U, { type: 'event', title: "Mam's birthday", start_at: '2026-05-30T12:00:00.000Z' }),
    );
    d.close();
    const sent: LeaveSuggestRequest[] = [];
    renderAt('/work', {
      suggest: (req) => {
        sent.push(req);
        return Promise.resolve({
          ok: true,
          error_code: null,
          message: 'ok',
          picks: [{ index: 0, why: 'Before the busy May weeks.' }],
        });
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Suggest leave' }));
    await user.click(await screen.findByRole('button', { name: 'Ask Airhead to pick' }));
    expect(await screen.findByText('Before the busy May weeks.')).toBeInTheDocument();
    expect(screen.getByText('Airhead’s picks')).toBeInTheDocument();
    expect(sent[0]?.candidates.length).toBeGreaterThan(1);
    expect(sent[0]?.context.occasions).toEqual([{ date: '2026-05-30', title: "Mam's birthday" }]);
  });
});
