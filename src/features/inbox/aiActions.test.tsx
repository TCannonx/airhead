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
import { baseRecord, newCapture, newItem, save } from '../../lib/db/repository';
import { updateSettingsData } from '../../lib/db/settings';
import { aiActionSchema, type AiAction } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string) {
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

async function seed(o: Partial<AiAction>) {
  const d = db();
  const row = await save(
    d,
    'ai_actions',
    aiActionSchema.parse({
      ...baseRecord(U),
      capture_id: null,
      kind: 'set_leave_remaining',
      status: 'applied',
      reason: null,
      summary: 'Leave left set to 9.5 days',
      quote: 'I have 9.5 days left',
      confidence: 0.9,
      payload: {},
      target_table: 'settings',
      target_id: U,
      before: { opening_used: null },
      after: { opening_used: { '2025-12-01': 11.5 } },
      ...o,
    }),
  );
  d.close();
  return row;
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('AI actions in the Inbox (Task 10.6)', () => {
  it('lists what AI did, and Undo puts the old value back', async () => {
    const d = db();
    await updateSettingsData(d, U, {
      work: { entitlement: 21, opening_used: { '2025-12-01': 11.5 } },
    });
    d.close();
    const a = await seed({});
    const user = userEvent.setup();
    renderAt('/inbox');

    const done = await screen.findByRole('list', { name: 'Done by AI' });
    expect(within(done).getByText('Leave left set to 9.5 days')).toBeInTheDocument();
    expect(within(done).getByText('“I have 9.5 days left”')).toBeInTheDocument();
    await user.click(
      within(done).getByRole('button', { name: 'Undo: Leave left set to 9.5 days' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Done by AI' })).not.toBeInTheDocument(),
    );
    const x = db();
    expect((await x.ai_actions.get(a.id))?.status).toBe('undone');
    expect((await x.settings.get(U))?.data.work).toEqual({ entitlement: 21 });
    x.close();
  });

  it('says so instead of overwriting a value changed since', async () => {
    const d = db();
    await updateSettingsData(d, U, { work: { opening_used: { '2025-12-01': 3 } } });
    d.close();
    await seed({});
    const user = userEvent.setup();
    renderAt('/inbox');
    await user.click(await screen.findByRole('button', { name: /^Undo:/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Changed since, so it was left as it is.',
    );
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/work');
  });

  it('proposals: Apply, Fix when there is nothing to apply, and Dismiss', async () => {
    await seed({
      kind: 'update_work_setting',
      status: 'proposed',
      reason: 'Not sure enough to do this by itself',
      summary: 'Entitlement set to 23 days',
      quote: 'I get 23 days',
      before: { entitlement: null },
      after: { entitlement: 23 },
    });
    await seed({
      status: 'proposed',
      reason: 'Set your yearly entitlement first (Settings → Work)',
      summary: 'Leave left set to 9.5 days',
      after: null,
    });
    const user = userEvent.setup();
    renderAt('/inbox');

    const asks = await screen.findByRole('list', { name: 'Needs your OK' });
    expect(within(asks).getByText('Not sure enough to do this by itself')).toBeInTheDocument();
    expect(within(asks).getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/work');
    await user.click(within(asks).getByRole('button', { name: 'Apply' }));
    await waitFor(async () => {
      const x = db();
      const work = (await x.settings.get(U))?.data.work;
      x.close();
      expect(work).toEqual({ entitlement: 23 });
    });
    await waitFor(() =>
      expect(within(asks).queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument(),
    );
    await user.click(within(asks).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Needs your OK' })).not.toBeInTheDocument(),
    );
  });

  it('"Which one?" offers each match by name and moves the one picked', async () => {
    const d = db();
    const a1 = await save(d, 'items', {
      ...newItem(U, { type: 'event', title: 'Team meeting' }),
      start_at: '2026-11-09T09:00:00.000Z',
    });
    const a2 = await save(d, 'items', {
      ...newItem(U, { type: 'event', title: 'Team meeting (clients)' }),
      start_at: '2026-11-11T09:00:00.000Z',
    });
    d.close();
    await seed({
      kind: 'reschedule_item',
      status: 'proposed',
      reason: 'Which one?',
      summary: 'Move “Team meeting”',
      target_table: null,
      target_id: null,
      before: null,
      after: null,
      payload: { choices: [a1.id, a2.id], start_at: '2026-11-13T10:00:00+00:00' },
    });
    const user = userEvent.setup();
    renderAt('/inbox');
    const asks = await screen.findByRole('list', { name: 'Needs your OK' });
    await user.click(
      await within(asks).findByRole('button', { name: /^Team meeting \(clients\)/ }),
    );
    await waitFor(async () => {
      const x = db();
      const moved = await x.items.get(a2.id);
      x.close();
      expect(moved?.start_at).toBe('2026-11-13T10:00:00.000Z');
    });
  });

  it('the capture chip says what was done', async () => {
    const d = db();
    const c = await save(d, 'captures', newCapture(U, { text: 'I have 9.5 days left' }));
    d.close();
    await seed({ capture_id: c.id });
    renderAt('/inbox');
    expect(await screen.findAllByText('Leave left set to 9.5 days')).not.toHaveLength(0);
  });
});
