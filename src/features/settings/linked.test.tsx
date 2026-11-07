import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { CalendarsService, Services } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { addLinkedCalendar } from '../../lib/db/feeds';
import { update } from '../../lib/db/repository';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderSettings(services: Services) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={services}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/settings'] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

const fakeCalendars = (): CalendarsService & {
  validate: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
} => ({
  validate: vi.fn((url: string) =>
    Promise.resolve(
      url.includes('bad')
        ? { ok: false, error_code: 'invalid', message: 'That link didn’t return a calendar.' }
        : {
            ok: true,
            error_code: null,
            message: 'Found 12 events.',
            name: 'Her Us calendar',
            count: 12,
          },
    ),
  ),
  refresh: vi.fn(() => Promise.resolve({ ok: true, error_code: null, message: 'Up to date.' })),
});

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Settings → Linked calendars (Task 4.9)', () => {
  it('checks a pasted link, then adds it and asks the server to read it', async () => {
    const calendars = fakeCalendars();
    const user = userEvent.setup();
    renderSettings({ ...localServices(), calendars });

    const form = await screen.findByRole('form', { name: 'Add a linked calendar' });
    const link = within(form).getByLabelText('Calendar link');
    await user.type(link, 'webcal://example.com/bad.ics');
    await user.click(screen.getByRole('button', { name: 'Check link' }));
    expect(await within(form).findByRole('status')).toHaveTextContent(
      'That link didn’t return a calendar.',
    );
    expect(screen.queryByRole('button', { name: 'Add calendar' })).not.toBeInTheDocument();

    await user.clear(link);
    await user.type(link, 'webcal://example.com/her/secret-123.ics');
    await user.click(screen.getByRole('button', { name: 'Check link' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('Found 12 events.');
    expect(screen.getByLabelText('Name')).toHaveValue('Her Us calendar');
    await user.click(screen.getByRole('radio', { name: 'Colour #7c3aed' }));
    await user.click(screen.getByRole('button', { name: 'Add calendar' }));

    const list = await screen.findByRole('list', { name: 'Linked calendars' });
    expect(within(list).getByText('Her Us calendar')).toBeInTheDocument();
    // The secret path is never shown, only the host.
    expect(
      within(list).getByText(/example\.com · waiting for the first fetch/),
    ).toBeInTheDocument();
    expect(list).not.toHaveTextContent('secret-123');

    const d = db();
    const [feed] = await d.feeds.toArray();
    d.close();
    expect(feed).toMatchObject({
      kind: 'linked_in',
      url: 'webcal://example.com/her/secret-123.ics',
      name: 'Her Us calendar',
      colour: '#7c3aed',
      enabled: true,
      token_hash: null,
    });
    await waitFor(() => expect(calendars.refresh).toHaveBeenCalledWith(feed?.id));
  });

  it('shows fetch errors, switches a calendar off and removes it', async () => {
    const d = db();
    const feed = await addLinkedCalendar(d, U, {
      url: 'https://cal.example.org/x.ics',
      name: 'Club fixtures',
      colour: '#0369a1',
    });
    await update(d, 'feeds', feed.id, { last_error: 'Couldn’t fetch it (HTTP 404).' });
    d.close();
    const user = userEvent.setup();
    renderSettings({ ...localServices(), calendars: fakeCalendars() });

    const list = await screen.findByRole('list', { name: 'Linked calendars' });
    expect(within(list).getByText('Couldn’t fetch it (HTTP 404).')).toBeInTheDocument();
    await user.click(within(list).getByRole('switch', { name: 'Show Club fixtures' }));
    await waitFor(async () => {
      const x = db();
      expect((await x.feeds.get(feed.id))?.enabled).toBe(false);
      x.close();
    });
    await user.click(within(list).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Linked calendars' })).not.toBeInTheDocument(),
    );
  });

  it('explains that linked calendars need a server', async () => {
    renderSettings(localServices());
    expect(
      await screen.findByText(/linked calendars are fetched by Airhead’s server/),
    ).toBeInTheDocument();
  });
});
