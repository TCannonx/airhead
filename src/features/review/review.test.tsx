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
import { newItem, save } from '../../lib/db/repository';
import { reviewTasks } from '../../lib/db/review';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const TZ = 'Europe/Dublin';

function renderAt(path: string) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
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

const task = (title: string, fields: Record<string, unknown> = {}) =>
  newItem(U, { type: 'task', title, ...fields });
const get = async (title: string) => {
  const d = db();
  const all = await d.items.toArray();
  d.close();
  return all.find((i) => i.title === title);
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-14T20:00:00Z')); // 21:00 Irish time
  localStorage.clear();
  await db().delete();
  const d = db();
  await save(d, 'items', task('Send invoice', { due_at: '2026-07-14T16:00:00.000Z' }));
  await save(d, 'items', task('Call plumber', { top3_date: '2026-07-14', carry_count: 2 }));
  await save(d, 'items', task('Overdue form', { due_at: '2026-07-10T09:00:00.000Z' }));
  await save(d, 'items', task('Next week', { due_at: '2026-07-21T09:00:00.000Z' }));
  await save(
    d,
    'items',
    task('Already done', { due_at: '2026-07-14T09:00:00.000Z', status: 'done' }),
  );
  d.close();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('evening review (Task 4.14)', () => {
  it('lists today’s open tasks: due today or earlier, or in today’s Top 3', () => {
    const items = [
      task('A', { due_at: '2026-07-14T22:30:00.000Z' }), // 23:30 Irish time, still today
      task('B', { due_at: '2026-07-14T23:30:00.000Z' }), // 00:30 tomorrow
      task('C', { top3_date: '2026-07-14' }),
      task('D'),
    ];
    expect(reviewTasks(items, '2026-07-14', TZ).map((t) => t.title)).toEqual(['C', 'A']);
  });

  it('ticks off, carries over (keeping the time, counting carries) and drops', async () => {
    const user = userEvent.setup();
    renderAt('/review');
    const list = await screen.findByRole('list', { name: "Today's open tasks" });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent?.split('Done')[0]),
    ).toEqual(['Call plumbercarried over 2×', 'Overdue form', 'Send invoice']);

    await user.click(screen.getByRole('button', { name: 'Done: Send invoice' }));
    await user.click(screen.getByRole('button', { name: 'Carry over: Call plumber' }));
    await user.click(screen.getByRole('button', { name: 'Carry over: Overdue form' }));
    expect(await screen.findByText('All done for today.')).toBeInTheDocument();

    expect(await get('Send invoice')).toMatchObject({ status: 'done' });
    expect((await get('Send invoice'))?.completed_at).toBeTruthy();
    expect(await get('Call plumber')).toMatchObject({ top3_date: '2026-07-15', carry_count: 3 });
    // 10:00 Irish time on 10 July becomes 10:00 tomorrow.
    expect(await get('Overdue form')).toMatchObject({
      due_at: '2026-07-15T09:00:00.000Z',
      carry_count: 1,
    });
  });

  it('drop and "carry all"', async () => {
    const user = userEvent.setup();
    renderAt('/review');
    await user.click(await screen.findByRole('button', { name: 'Drop: Overdue form' }));
    await waitFor(async () => expect((await get('Overdue form'))?.status).toBe('dropped'));
    await user.click(screen.getByRole('button', { name: 'Carry all to tomorrow' }));
    expect(await screen.findByText('All done for today.')).toBeInTheDocument();
    expect((await get('Send invoice'))?.due_at).toBe('2026-07-15T16:00:00.000Z');
  });
});
