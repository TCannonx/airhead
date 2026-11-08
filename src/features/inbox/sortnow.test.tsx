import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { Services, SortingService } from '../../lib/auth/types';
import { createCapture } from '../../lib/db/captures';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { SortProvider } from '../../lib/sort/SortProvider';
import { SyncContext } from '../../lib/sync/context';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function setup(
  sorting: SortingService | undefined,
  path = '/inbox',
  syncNow: Mock<() => Promise<void>> = vi.fn(async () => {}),
) {
  const services: Services = { ...localServices(), sorting };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={services}>
      <DataProvider userId={U}>
        <SyncContext value={{ status: null, syncNow }}>
          <SortProvider syncWaitMs={50}>
            <AppLockProvider>
              <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
            </AppLockProvider>
          </SortProvider>
        </SyncContext>
      </DataProvider>
    </AuthProvider>,
  );
  return { syncNow };
}

const fakeSorting = (message = 'Sorted 1 capture.') => ({
  sortNow: vi.fn(async () => ({ ok: true, error_code: null, message })),
});

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('sorting triggers', () => {
  it('on app open with unsorted captures: syncs, sorts once, syncs again', async () => {
    const d = db();
    await createCapture(d, U, { text: 'ring the plumber' });
    d.close();
    const sorting = fakeSorting();
    const { syncNow } = setup(sorting);

    await waitFor(() => expect(sorting.sortNow).toHaveBeenCalledOnce());
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(2));
    expect(syncNow.mock.invocationCallOrder[0]).toBeLessThan(
      sorting.sortNow.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('on app open with nothing waiting: no sorting call', async () => {
    const sorting = fakeSorting();
    setup(sorting);
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sorting.sortNow).not.toHaveBeenCalled();
  });

  it('"Sort now" sorts on demand and shows the result', async () => {
    const d = db();
    await createCapture(d, U, { text: 'ring the plumber' });
    d.close();
    const sorting = fakeSorting('Sorted 3 captures.');
    setup(sorting);
    await waitFor(() => expect(sorting.sortNow).toHaveBeenCalledOnce()); // app open

    await userEvent.click(await screen.findByRole('button', { name: 'Sort now' }));
    await waitFor(() => expect(sorting.sortNow).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Sorted 3 captures.')).toBeVisible();
  });

  it('shows the plain message when sorting is not possible', async () => {
    const d = db();
    await createCapture(d, U, { text: 'x' });
    d.close();
    const sorting = {
      sortNow: vi.fn(async () => ({
        ok: false,
        error_code: 'cap_reached',
        message: 'This month’s AI limit has been reached.',
      })),
    };
    setup(sorting);
    await userEvent.click(await screen.findByRole('button', { name: 'Sort now' }));
    expect(await screen.findByText(/AI limit has been reached/)).toBeVisible();
  });

  it('a sync that never finishes does not stop sorting', async () => {
    const d = db();
    await createCapture(d, U, { text: 'ring the plumber' });
    d.close();
    const sorting = fakeSorting('Sorted 1 capture.');
    setup(
      sorting,
      '/inbox',
      vi.fn(() => new Promise<void>(() => {})),
    );
    await waitFor(() => expect(sorting.sortNow).toHaveBeenCalledOnce());
    expect(await screen.findByText('Sorted 1 capture.')).toBeVisible();
  });

  it('an error on the device shows a message instead of doing nothing', async () => {
    const d = db();
    await createCapture(d, U, { text: 'x' });
    d.close();
    const sorting = { sortNow: vi.fn(() => Promise.reject(new Error('boom'))) };
    setup(sorting);
    expect(await screen.findByText(/Sorting could not start on this device/)).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: 'Sort now' }));
    await waitFor(() => expect(sorting.sortNow).toHaveBeenCalledTimes(2));
  });

  it('local mode (no server): no Sort now button', async () => {
    const d = db();
    await createCapture(d, U, { text: 'x' });
    d.close();
    setup(undefined);
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    expect(screen.queryByRole('button', { name: 'Sort now' })).not.toBeInTheDocument();
  });
});
