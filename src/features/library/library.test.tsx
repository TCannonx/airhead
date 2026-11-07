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
import { baseRecord, newItem, save, softDelete } from '../../lib/db/repository';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
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
});

describe('Inbox', () => {
  it('lists unsorted captures and sorts one by hand (recording a correction)', async () => {
    const d = db();
    await createCapture(d, U, { text: 'ring the plumber' });
    d.close();
    renderAt('/inbox');

    const unsorted = await screen.findByRole('list', { name: 'Unsorted' });
    const card = await within(unsorted).findByText('ring the plumber');
    expect(card).toBeVisible();
    await userEvent.click(within(unsorted).getByRole('button', { name: 'Sort as Task' }));

    await waitFor(() =>
      expect(within(unsorted).queryByText('ring the plumber')).not.toBeInTheDocument(),
    );
    const [task] = await db().items.toArray();
    expect(task).toMatchObject({ type: 'task', title: 'Ring the plumber' });
    expect(await db().corrections.count()).toBe(1);
  });

  it('has a "To flesh out" section', async () => {
    renderAt('/inbox');
    expect(await screen.findByRole('heading', { name: 'To flesh out' })).toBeVisible();
  });
});

describe('Library', () => {
  async function seed() {
    const d = db();
    const topic = await save(d, 'topics', { ...baseRecord(U), name: 'Garden' });
    await save(
      d,
      'items',
      newItem(U, { type: 'idea', title: 'Raised beds', topic_ids: [topic.id] }),
    );
    await save(d, 'items', newItem(U, { type: 'reading', title: 'Compost guide' }));
    await save(
      d,
      'items',
      newItem(U, { type: 'note', title: 'Shed notes', topic_ids: [topic.id] }),
    );
    d.close();
    return topic;
  }

  it('shows everything, then filters by type tab and by topic', async () => {
    await seed();
    renderAt('/library');
    const list = await screen.findByRole('list', { name: 'Items' });
    await within(list).findByText('Raised beds');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Ideas' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(within(list).getByText('Raised beds')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.selectOptions(screen.getByLabelText('Topic'), 'Garden');
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
  });

  it('opens an item, edits it, changes its type and deletes it to the Trash', async () => {
    await seed();
    const router = renderAt('/library');
    await userEvent.click(await screen.findByRole('link', { name: /Shed notes/ }));

    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Shed plans');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'idea');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      const item = (await db().items.toArray()).find((i) => i.title === 'Shed plans');
      expect(item?.type).toBe('idea');
    });
    expect(await db().corrections.count()).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    const deleted = (await db().items.toArray()).find((i) => i.title === 'Shed plans');
    expect(deleted?.deleted_at).not.toBeNull();
  });

  it('restores an item from the Trash', async () => {
    const d = db();
    const item = await save(d, 'items', newItem(U, { type: 'note', title: 'Oops' }));
    await softDelete(d, 'items', item.id);
    d.close();
    renderAt('/library/trash');

    const trash = await screen.findByRole('list', { name: 'Trash' });
    await within(trash).findByText('Oops');
    await userEvent.click(within(trash).getByRole('button', { name: 'Restore' }));
    await waitFor(async () => expect((await db().items.get(item.id))?.deleted_at).toBeNull());
    expect(screen.getByText(/deleted for good after 30 days/i)).toBeVisible();
  });
});
