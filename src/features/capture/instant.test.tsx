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
import { AppLockProvider } from '../applock/AppLockProvider';

const toastMs = vi.hoisted(() => ({ value: 8_000 }));
vi.mock('./toast', () => ({
  get TOAST_MS() {
    return toastMs.value;
  },
}));

function renderAt(path: string) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={LOCAL_USER_ID}>
        <AppLockProvider>
          <RouterProvider router={router} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}
const db = () => openUserDb(LOCAL_USER_ID);

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});
afterEach(() => {
  toastMs.value = 8_000;
});

describe('instant events on the Capture tab', () => {
  it('a clear date adds an event at once, with an Undo toast and an event chip', async () => {
    renderAt('/capture');
    await userEvent.type(await screen.findByLabelText('Capture'), 'dentist tomorrow 3pm{Enter}');

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/Event added: \w{3} 15:00/);
    const recent = await screen.findByRole('list', { name: 'Recent captures' });
    expect(await within(recent).findByText(/Event added: \w{3} 15:00/)).toBeVisible();
    const [event] = await db().items.where('type').equals('event').toArray();
    expect(event).toMatchObject({ status: 'open', title: 'Dentist', calendar: 'personal' });

    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect((await db().items.get(event?.id ?? ''))?.deleted_at).not.toBeNull();
    expect(await within(recent).findByText('Sorting soon')).toBeVisible();
  });

  it('the Undo toast disappears by itself (after TOAST_MS)', async () => {
    toastMs.value = 300;
    renderAt('/capture');
    await userEvent.type(await screen.findByLabelText('Capture'), 'dentist tomorrow 3pm{Enter}');
    expect(await screen.findByRole('status')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), {
      timeout: 2_000,
    });
  });

  it('TOAST_MS is 8 seconds', async () => {
    const real = await vi.importActual<typeof import('./toast')>('./toast');
    expect(real.TOAST_MS).toBe(8_000);
  });

  it('a fuzzy date makes a suggestion card on Today instead', async () => {
    const view = renderAt('/capture');
    await userEvent.type(
      await screen.findByLabelText('Capture'),
      'sometime next week call the bank{Enter}',
    );
    const recent = await screen.findByRole('list', { name: 'Recent captures' });
    expect(await within(recent).findByText(/Suggestion/)).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    view.unmount();

    renderAt('/today');
    const cards = await screen.findByRole('list', { name: 'Suggestions' });
    expect(within(cards).getByText(/Call the bank/)).toBeVisible();
    await userEvent.click(within(cards).getByRole('button', { name: 'Add to calendar' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Suggestions' })).not.toBeInTheDocument(),
    );
    const [event] = await db().items.where('type').equals('event').toArray();
    expect(event?.status).toBe('open');
  });

  it('a suggestion can be dismissed', async () => {
    renderAt('/capture');
    await userEvent.type(await screen.findByLabelText('Capture'), 'maybe drinks Friday 6pm{Enter}');
    await screen.findByText(/Suggestion/);
    renderAt('/today');
    const cards = (await screen.findAllByRole('list', { name: 'Suggestions' }))[0];
    await userEvent.click(within(cards as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    await waitFor(async () => {
      const [event] = await db().items.where('type').equals('event').toArray();
      expect(event?.status).toBe('dropped');
    });
  });
});
