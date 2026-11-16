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
import { baseRecord, newItem, save } from '../../lib/db/repository';
import { pageItemSchema, pageSchema, type Page } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string) {
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

function page(o: Partial<Page>): Page {
  return pageSchema.parse({
    ...baseRecord(U),
    kind: 'series',
    key: `k:${Math.random()}`,
    name: 'Training',
    summary: '',
    facts: [],
    status: 'active',
    item_count: 1,
    last_item_at: null,
    summary_stale: false,
    summarised_at: null,
    rebuild_requested_at: null,
    collated: {},
    ...o,
  });
}

async function seed() {
  const d = db();
  const training = await save(
    d,
    'items',
    newItem(U, { type: 'event', title: 'Training', start_at: '2026-11-11T08:00:00Z' }),
  );
  const p = await save(
    d,
    'pages',
    page({
      summary: 'Weekly training at the gym.',
      facts: [{ date: '2026-11-11', text: 'Brought boots' }],
    }),
  );
  await save(d, 'pages', page({ kind: 'person', name: 'Niamh' }));
  await save(d, 'pages', page({ kind: 'person', name: 'Waiting', status: 'pending_approval' }));
  await d.page_items.put(
    pageItemSchema.parse({
      ...baseRecord(U),
      page_id: p.id,
      item_id: training.id,
      note: 'The first one',
    }),
  );
  d.close();
  return { training, p };
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Library → Pages (Task 14.10)', () => {
  it('lists active pages by kind and opens one with its summary, facts and items', async () => {
    const { p } = await seed();
    const user = userEvent.setup();
    const router = renderAt('/library/pages');
    expect(await screen.findByRole('list', { name: 'Repeating events' })).toHaveTextContent(
      'Training',
    );
    expect(screen.getByRole('list', { name: 'People' })).toHaveTextContent('Niamh');
    expect(screen.queryByText('Waiting')).toBeNull();
    await user.click(screen.getByRole('link', { name: /Training/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/library/pages/${p.id}`));
    expect(await screen.findByText('Weekly training at the gym.')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Facts' })).toHaveTextContent('Brought boots');
    expect(screen.getByRole('list', { name: 'Items' })).toHaveTextContent('The first one');
  });

  it('Rebuild, Rename and Archive change the page and queue it for sync', async () => {
    const { p } = await seed();
    const user = userEvent.setup();
    renderAt(`/library/pages/${p.id}`);
    await user.click(await screen.findByRole('button', { name: 'Rebuild' }));
    expect(await screen.findByText('Rebuild asked for: tonight.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Club training');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Club training' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(async () => {
      const d = db();
      const row = await d.pages.get(p.id);
      const queued = await d.outbox.where('table').equals('pages').count();
      d.close();
      expect([row?.status, row?.name, !!row?.rebuild_requested_at]).toEqual([
        'archived',
        'Club training',
        true,
      ]);
      expect(queued).toBeGreaterThan(0);
    });
  });

  it('an item links to the pages it belongs to', async () => {
    const { training } = await seed();
    renderAt(`/library/item/${training.id}`);
    const list = await screen.findByRole('list', { name: 'Pages for this item' });
    expect(within(list).getByRole('link', { name: /Training/ })).toBeVisible();
  });
});
