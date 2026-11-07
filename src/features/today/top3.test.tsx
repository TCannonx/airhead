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
import { carryOverCandidates } from '../../lib/db/top3';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const id = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`;

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
const get = async (i: string) => {
  const d = db();
  const x = await d.items.get(i);
  d.close();
  return x;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T09:00:00Z'));
  localStorage.clear();
  await db().delete();
  const d = db();
  for (const [n, title] of [
    [1, 'One'],
    [2, 'Two'],
    [3, 'Three'],
  ] as const) {
    await save(d, 'items', {
      ...newItem(U, { type: 'task', title, top3_date: '2026-07-15' }),
      id: id(n),
    });
  }
  await save(d, 'items', { ...newItem(U, { type: 'task', title: 'Four' }), id: id(4) });
  await save(d, 'items', {
    ...newItem(U, {
      type: 'task',
      title: 'From yesterday',
      top3_date: '2026-07-14',
      carry_count: 1,
    }),
    id: id(5),
  });
  await save(d, 'items', {
    ...newItem(U, { type: 'task', title: 'Due yesterday', due_at: '2026-07-14T15:00:00.000Z' }),
    id: id(6),
  });
  d.close();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Top 3 and carry-over prompts (Task 5.8)', () => {
  it('finds yesterday’s unfinished Top 3 and due tasks', () => {
    const items = [
      newItem(U, { type: 'task', title: 'a', top3_date: '2026-07-14' }),
      newItem(U, { type: 'task', title: 'b', due_at: '2026-07-14T10:00:00.000Z' }),
      newItem(U, { type: 'task', title: 'c', top3_date: '2026-07-14', status: 'done' }),
      newItem(U, { type: 'task', title: 'd', top3_date: '2026-07-15' }),
      newItem(U, { type: 'task', title: 'e', due_at: '2026-07-13T10:00:00.000Z' }),
    ];
    expect(carryOverCandidates(items, '2026-07-15', 'UTC').map((i) => i.title)).toEqual(['a', 'b']);
  });

  it('a fourth task asks which to swap', async () => {
    const user = userEvent.setup();
    renderAt(`/library/item/${id(4)}`);
    await user.click(await screen.findByRole('button', { name: 'Add to today’s Top 3' }));
    const swap = await screen.findByRole('group', { name: 'Swap with' });
    await user.click(within(swap).getByRole('button', { name: 'Two' }));
    await waitFor(async () => expect((await get(id(4)))?.top3_date).toBe('2026-07-15'));
    expect((await get(id(2)))?.top3_date).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Remove from today’s Top 3' }),
    ).toBeInTheDocument();
  });

  it('morning cards: Today carries over (counting it), Done and Drop close it', async () => {
    const user = userEvent.setup();
    renderAt('/today');
    const cards = await screen.findByRole('list', { name: 'From yesterday' });
    expect(within(cards).getAllByRole('listitem')).toHaveLength(2);

    await user.click(within(cards).getByRole('button', { name: 'Today: From yesterday' }));
    await waitFor(async () =>
      expect(await get(id(5))).toMatchObject({ top3_date: '2026-07-15', carry_count: 2 }),
    );
    await user.click(
      within(screen.getByRole('list', { name: 'From yesterday' })).getByRole('button', {
        name: 'Drop: Due yesterday',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'From yesterday' })).not.toBeInTheDocument(),
    );
    expect((await get(id(6)))?.status).toBe('dropped');
  });

  it('removing from Top 3 on Today', async () => {
    const user = userEvent.setup();
    renderAt('/today');
    await user.click(await screen.findByRole('button', { name: 'Remove from Top 3: One' }));
    await waitFor(async () => expect((await get(id(1)))?.top3_date).toBeNull());
  });
});
