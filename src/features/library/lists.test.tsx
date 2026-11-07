import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { newCapture, newItem, save } from '../../lib/db/repository';
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
  localStorage.clear();
  await db().delete();
});

describe('Lists', () => {
  it('starts with a Shopping list; add, tick off and clear completed', async () => {
    renderAt('/library/lists');
    expect(await screen.findByRole('heading', { level: 2, name: 'Shopping' })).toBeVisible();

    const add = screen.getByLabelText('Add to Shopping');
    await userEvent.type(add, 'Milk{Enter}');
    await userEvent.type(add, 'Bin bags{Enter}');
    const entries = await screen.findByRole('list', { name: 'Shopping entries' });
    await waitFor(() => expect(within(entries).getAllByRole('checkbox')).toHaveLength(2));

    await userEvent.click(within(entries).getByRole('checkbox', { name: 'Milk' }));
    await waitFor(() =>
      expect(within(entries).getByRole('checkbox', { name: 'Milk' })).toBeChecked(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Clear completed' }));
    await waitFor(() =>
      expect(within(entries).queryByRole('checkbox', { name: 'Milk' })).not.toBeInTheDocument(),
    );
    expect(within(entries).getByRole('checkbox', { name: 'Bin bags' })).not.toBeChecked();
  });

  it('creates, renames and reorders lists', async () => {
    renderAt('/library/lists');
    await screen.findByRole('heading', { level: 2, name: 'Shopping' });

    await userEvent.type(screen.getByLabelText('New list'), 'Packing{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Packing' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const nameBox = screen.getByLabelText('List name');
    await userEvent.clear(nameBox);
    await userEvent.type(nameBox, 'Holiday packing{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Holiday packing' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Move up' }));
    const chooser = screen.getByRole('group', { name: 'Lists' });
    await waitFor(() =>
      expect(
        within(chooser)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Holiday packing', 'Shopping']),
    );
  });

  it('is reachable from the Library, whose All tab leaves list entries out', async () => {
    const d = db();
    await save(d, 'items', newItem(U, { type: 'list_entry', title: 'Milk' }));
    await save(d, 'items', newItem(U, { type: 'note', title: 'A note' }));
    d.close();
    renderAt('/library');
    const items = await screen.findByRole('list', { name: 'Items' });
    await within(items).findByText('A note');
    expect(within(items).queryByText('Milk')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('href', '/library/lists');
  });
});

describe('Inbox → "Create list" for an unknown list', () => {
  it('creates the list and files the entry', async () => {
    const d = db();
    const capture = await save(
      d,
      'captures',
      newCapture(U, { text: 'passport for the trip', status: 'needs_review' }),
    );
    await save(
      d,
      'items',
      newItem(U, {
        type: 'list_entry',
        title: 'Passport',
        status: 'suggested',
        capture_id: capture.id,
        data: { proposed_list: 'Packing' },
      }),
    );
    d.close();
    renderAt('/inbox');
    const review = await screen.findByRole('list', { name: 'Needs a tap' });
    await userEvent.click(within(review).getByRole('button', { name: "Create list 'Packing'" }));

    await waitFor(async () => {
      const [list] = (await db().lists.toArray()).filter((l) => l.name === 'Packing');
      const [entry] = await db().items.toArray();
      expect(entry).toMatchObject({ list_id: list?.id, status: 'open' });
    });
    await waitFor(async () => expect((await db().captures.get(capture.id))?.status).toBe('sorted'));
  });
});
