import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { Services, WorkshopService } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { newItem, save } from '../../lib/db/repository';
import { addDraft } from '../../lib/db/workshop';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

const CONTENT = {
  summary: 'A timber shed for bikes.',
  sections: [{ heading: 'What it involves', body: 'A base and a frame.' }],
  open_questions: ['How big?'],
  next_steps: ['Measure the wall'],
};

function renderAt(path: string, services: Services) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider services={services}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={router} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
  return router;
}

async function idea() {
  const d = db();
  const item = await save(
    d,
    'items',
    newItem(U, { type: 'idea', title: 'Garden shed', data: { workshop: true } }),
  );
  d.close();
  return item;
}

function fakeWorkshop(itemId: string) {
  const calls: string[] = [];
  const service: WorkshopService = {
    fleshOut: (id) => {
      calls.push(id);
      const at = new Date().toISOString();
      return Promise.resolve({
        ok: true,
        error_code: null,
        message: 'Draft ready.',
        draft: {
          id: crypto.randomUUID(),
          user_id: U,
          item_id: itemId,
          version: 1,
          content: CONTENT,
          source: 'auto',
          created_at: at,
          updated_at: at,
          server_updated_at: at,
          deleted_at: null,
        },
      });
    },
  };
  return { service, calls };
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('Workshop (Task 7.6)', () => {
  it('the Inbox "To flesh out" opens the Workshop; Auto flesh-out shows the draft', async () => {
    const item = await idea();
    const { service, calls } = fakeWorkshop(item.id);
    const router = renderAt('/inbox', { ...localServices(), workshop: service });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Garden shed' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/workshop/${item.id}`));

    expect(await screen.findByText(/No draft yet/)).toBeInTheDocument();
    expect(screen.getByText(/One AI call, ≈ €0\.02/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Auto flesh-out' }));
    expect(await screen.findByText('A timber shed for bikes.')).toBeInTheDocument();
    expect(screen.getByText('How big?')).toBeInTheDocument();
    expect(screen.getByText('Measure the wall')).toBeInTheDocument();
    expect(calls).toEqual([item.id]);
    expect(screen.getByRole('link', { name: 'Open the original' })).toHaveAttribute(
      'href',
      `/library/item/${item.id}`,
    );
  });

  it('shows the newest version, with older ones one tap away', async () => {
    const item = await idea();
    const d = db();
    await addDraft(d, U, item.id, { ...CONTENT, summary: 'First go.' }, 'auto');
    await addDraft(d, U, item.id, { ...CONTENT, summary: 'Second go.' }, 'session');
    d.close();
    renderAt(`/workshop/${item.id}`, {
      ...localServices(),
      workshop: fakeWorkshop(item.id).service,
    });
    expect(await screen.findByText('Second go.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Version 1' }));
    expect(await screen.findByText('First go.')).toBeInTheDocument();
    expect(screen.queryByText('Second go.')).toBeNull();
  });

  it('offline: the button is off and says why; local mode explains the server is needed', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const item = await idea();
    renderAt(`/workshop/${item.id}`, {
      ...localServices(),
      workshop: fakeWorkshop(item.id).service,
    });
    expect(await screen.findByRole('button', { name: 'Auto flesh-out' })).toBeDisabled();
    expect(screen.getByText('Fleshing out needs a connection.')).toBeInTheDocument();
  });
});
