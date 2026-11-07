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
import { baseRecord, newItem, save } from '../../lib/db/repository';
import type { Brief } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const T1 = '00000000-0000-4000-8000-0000000000b1';
const T2 = '00000000-0000-4000-8000-0000000000b2';
const T3 = '00000000-0000-4000-8000-0000000000b3';

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

const get = async (id: string) => {
  const d = db();
  const i = await d.items.get(id);
  d.close();
  return i;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T06:30:00Z')); // 07:30 in Dublin (test TZ is UTC: 06:30 local)
  localStorage.clear();
  await db().delete();
  const d = db();
  await save(d, 'items', {
    ...newItem(U, {
      type: 'task',
      title: 'Call plumber',
      due_at: '2026-07-15T09:00:00.000Z',
      carry_count: 3,
    }),
    id: T1,
  });
  await save(d, 'items', {
    ...newItem(U, { type: 'task', title: 'Send invoice', due_at: '2026-07-14T16:00:00.000Z' }),
    id: T2,
  });
  await save(d, 'items', { ...newItem(U, { type: 'task', title: 'Read contract' }), id: T3 });
  await save(
    d,
    'items',
    newItem(U, {
      type: 'event',
      title: 'Dentist',
      calendar: 'personal',
      start_at: '2026-07-15T14:00:00.000Z',
      end_at: '2026-07-15T14:30:00.000Z',
    }),
  );
  d.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const brief = (): Brief => ({
  ...baseRecord(U),
  local_date: '2026-07-15',
  status: 'ok',
  model: 'claude-sonnet-5-5',
  cost_eur: 0.01,
  content: {
    reflection: 'Yesterday you cleared four tasks. Today is busy around lunch.',
    top3: [
      {
        item_id: T1,
        title: 'Call plumber',
        why: 'slipped 3 times',
        minutes: 15,
        slot: { start: '08:00', end: '08:15' },
      },
      { item_id: T2, title: 'Send invoice', why: 'overdue', minutes: 60, slot: null },
    ],
    also_today: [T3],
    prep: [],
  },
});

describe('Today tab (Task 5.7)', () => {
  it('with a brief: the lines, events, Top 3 with slots, and Also today', async () => {
    const d = db();
    await save(d, 'briefs', brief());
    d.close();
    const user = userEvent.setup();
    renderAt('/today');

    expect(await screen.findByLabelText('Morning brief')).toHaveTextContent(
      'Yesterday you cleared four tasks.',
    );
    expect(
      within(screen.getByRole('list', { name: "Today's events" })).getByText('Dentist'),
    ).toBeInTheDocument();
    const top = screen.getByRole('list', { name: 'Top 3' });
    expect(within(top).getByText('slipped 3 times')).toBeInTheDocument();
    expect(within(top).getByText('No free slot today')).toBeInTheDocument();
    expect(screen.getByText('Also today (1)')).toBeInTheDocument();

    await user.click(within(top).getByRole('button', { name: 'Block 08:00–08:15' }));
    await waitFor(async () => expect((await get(T1))?.start_at).toBeTruthy());
    expect(await within(top).findByText(/On the calendar at 08:00/)).toBeInTheDocument();

    await user.click(within(top).getByRole('checkbox', { name: 'Done: Send invoice' }));
    await waitFor(async () => expect((await get(T2))?.status).toBe('done'));
  });

  it('without a brief (offline): the device picks the Top 3 itself', async () => {
    renderAt('/today');
    const top = await screen.findByRole('list', { name: 'Top 3' });
    // Overdue first, then due today; nothing else is due.
    expect(
      within(top)
        .getAllByRole('listitem')
        .map((li) => li.textContent?.split('Block')[0]),
    ).toEqual(['Send invoice', 'Call plumber', 'Read contract']);
    expect(screen.getByText(/Picked on this device/)).toBeInTheDocument();
  });

  it('the desktop panel shows Today at a glance', async () => {
    renderAt('/library', 1440);
    const glance = await screen.findByLabelText('Today at a glance');
    expect(within(glance).getByRole('list', { name: 'Top 3' })).toBeInTheDocument();
  });
});
