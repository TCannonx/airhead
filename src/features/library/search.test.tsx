import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { createCapture } from '../../lib/db/captures';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { newItem, save } from '../../lib/db/repository';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string, width = 1440) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={router} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
  return router;
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  const d = db();
  await save(d, 'items', newItem(U, { type: 'idea', title: 'Raised garden beds', body: 'cedar' }));
  await save(d, 'items', newItem(U, { type: 'note', title: 'Shed', body: 'needs a new roof' }));
  await createCapture(d, U, { text: 'ring the plumber about the boiler' });
  d.close();
});

describe('Library search', () => {
  it('searches item titles, bodies and capture text as you type', async () => {
    renderAt('/library');
    const box = await screen.findByRole('searchbox', { name: 'Search' });

    await userEvent.type(box, 'roof');
    const results = await screen.findByRole('list', { name: 'Search results' });
    await waitFor(() => expect(within(results).getAllByRole('listitem')).toHaveLength(1));
    expect(within(results).getByRole('link', { name: /Shed/ })).toBeVisible();

    await userEvent.clear(box);
    await userEvent.type(box, 'boiler');
    // Clearing the box unmounts the results list; look it up again.
    const again = await screen.findByRole('list', { name: 'Search results' });
    expect(await within(again).findByText('ring the plumber about the boiler')).toBeVisible();
    expect(within(again).getByText('Capture')).toBeVisible();
  });

  it('says so when nothing matches', async () => {
    renderAt('/library');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search' }), 'zebra');
    expect(await screen.findByText(/No matches/)).toBeVisible();
  });

  it('"/" on desktop jumps to the Library search from anywhere', async () => {
    const router = renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await userEvent.keyboard('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveFocus());
  });

  it('"/" does nothing while typing in a field', async () => {
    const router = renderAt('/capture');
    const box = await screen.findByLabelText('Capture');
    await userEvent.type(box, 'a/b');
    expect(box).toHaveValue('a/b');
    expect(router.state.location.pathname).toBe('/capture');
  });
});
