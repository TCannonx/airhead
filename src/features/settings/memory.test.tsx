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
import { createList } from '../../lib/db/lists';
import { baseRecord, save } from '../../lib/db/repository';
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

const fact = (
  text: string,
  status: 'active' | 'pending_approval' | 'archived',
  category = 'everyday',
) => ({
  ...baseRecord(U),
  text,
  category: category as 'everyday' | 'person' | 'personal',
  status,
  source_capture_id: null,
  last_used_at: null,
});

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  const d = db();
  await save(d, 'memory_facts', fact('Trains on Tuesdays at 7pm', 'active'));
  await save(d, 'memory_facts', fact('Jim is a close friend', 'pending_approval', 'person'));
  await save(d, 'memory_facts', fact('Liked salsa classes', 'archived'));
  const shop = await createList(d, U, 'Shopping');
  await save(d, 'learned_rules', {
    ...baseRecord(U),
    pattern: 'buy',
    match_kind: 'prefix',
    result: { type: 'list_entry', list_id: shop.id },
    hits: 6,
    enabled: true,
  });
  d.close();
});

describe('Settings → What Airhead knows about me', () => {
  it('lists known, waiting and archived facts; edits, deletes and adds', async () => {
    renderAt('/settings');
    const known = await screen.findByRole('list', { name: 'Known facts' });
    expect(await within(known).findByDisplayValue('Trains on Tuesdays at 7pm')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Waiting for your OK' })).toHaveTextContent(
      'Jim is a close friend',
    );
    expect(screen.getByRole('list', { name: 'Archived facts' })).toHaveTextContent(
      'Liked salsa classes',
    );

    const box = within(known).getByDisplayValue('Trains on Tuesdays at 7pm');
    await userEvent.clear(box);
    await userEvent.type(box, 'Trains on Tuesdays and Thursdays at 7pm');
    await userEvent.click(within(known).getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await db().memory_facts.toArray()).some((f) => f.text.includes('Thursdays'))).toBe(
        true,
      ),
    );

    await userEvent.type(screen.getByLabelText('Add a fact'), 'Lives in Dublin{Enter}');
    await waitFor(async () =>
      expect(
        (await db().memory_facts.toArray()).find((f) => f.text === 'Lives in Dublin')?.status,
      ).toBe('active'),
    );

    await userEvent.click(
      within(known).getAllByRole('button', { name: 'Delete' })[0] as HTMLElement,
    );
    await waitFor(async () =>
      expect((await db().memory_facts.toArray()).filter((f) => f.deleted_at)).toHaveLength(1),
    );
  });

  it('approves a waiting fact and restores an archived one', async () => {
    renderAt('/settings');
    const waiting = await screen.findByRole('list', { name: 'Waiting for your OK' });
    await userEvent.click(within(waiting).getByRole('button', { name: 'Remember' }));
    await waitFor(async () =>
      expect(
        (await db().memory_facts.toArray()).find((f) => f.text.startsWith('Jim'))?.status,
      ).toBe('active'),
    );
    await userEvent.click(
      within(screen.getByRole('list', { name: 'Archived facts' })).getByRole('button', {
        name: 'Restore',
      }),
    );
    await waitFor(async () =>
      expect(
        (await db().memory_facts.toArray()).find((f) => f.text.startsWith('Liked'))?.status,
      ).toBe('active'),
    );
  });

  it('lists learned rules with an on/off switch', async () => {
    renderAt('/settings');
    const rules = await screen.findByRole('list', { name: 'Learned rules' });
    expect(await within(rules).findByText(/“buy …” → Shopping list/)).toBeVisible();
    const toggle = within(rules).getByRole('switch', { name: /buy/ });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(async () => expect((await db().learned_rules.toArray())[0]?.enabled).toBe(false));
  });
});

describe('Inbox → fact approval cards', () => {
  it('a fact about a person waits for one tap', async () => {
    renderAt('/inbox');
    const review = await screen.findByRole('list', { name: 'Needs a tap' });
    expect(within(review).getByText('Jim is a close friend')).toBeVisible();
    await userEvent.click(within(review).getByRole('button', { name: 'Don’t remember' }));
    await waitFor(async () =>
      expect(
        (await db().memory_facts.toArray()).find((f) => f.text.startsWith('Jim'))?.deleted_at,
      ).not.toBeNull(),
    );
  });
});
