import { render, screen, within } from '@testing-library/react';
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
import { aiActionSchema } from '../../lib/schemas/records';
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

async function seed() {
  const d = db();
  const cap = await save(
    d,
    'captures',
    newCapture(U, { text: 'Training on Tuesday. Remind me the day before', status: 'sorted' }),
  );
  const ev = await save(
    d,
    'items',
    newItem(U, {
      type: 'event',
      title: 'Training',
      capture_id: cap.id,
      start_at: '2030-11-12T19:00:00.000Z',
      data: { quote: 'Training on Tuesday', reminder_offset_minutes: 1440 },
    }),
  );
  await save(
    d,
    'ai_actions',
    aiActionSchema.parse({
      ...baseRecord(U),
      capture_id: cap.id,
      kind: 'set_reminder',
      status: 'applied',
      reason: null,
      summary: 'Reminder 1 day before Training',
      quote: 'Remind me the day before',
      confidence: 0.9,
      payload: {},
      target_table: 'items',
      target_id: ev.id,
      before: { data: { quote: 'Training on Tuesday' } },
      after: { data: { quote: 'Training on Tuesday', reminder_offset_minutes: 1440 } },
    }),
  );
  const waiting = await save(d, 'captures', newCapture(U, { text: 'call mum' }));
  d.close();
  return { cap, ev, waiting };
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('What Airhead did, on captures and items (Task 12.3)', () => {
  it('Capture → Recent: each capture has a receipt; the item links, the action can be undone', async () => {
    const { ev } = await seed();
    const user = userEvent.setup();
    renderAt('/capture');
    const recent = await screen.findByRole('list', { name: 'Recent captures' });
    const rows = within(recent).getAllByRole('listitem');
    const waitingRow = rows[0] as HTMLElement;
    const sortedRow = rows[1] as HTMLElement;
    await user.click(await within(waitingRow).findByText('What Airhead did'));
    expect(within(waitingRow).getByText(/^Waiting for AI sorting \(next check by/)).toBeVisible();

    await user.click(await within(sortedRow).findByText('What Airhead did'));
    const lines = within(sortedRow).getByRole('list', { name: 'What Airhead did' });
    expect(within(lines).getByRole('link', { name: 'Made an event: Training' })).toHaveAttribute(
      'href',
      `/library/item/${ev.id}`,
    );
    expect(within(lines).getByText('from “Training on Tuesday”')).toBeVisible();
    expect(within(lines).getByText('from “Remind me the day before”')).toBeVisible();
    await user.click(
      within(lines).getByRole('button', { name: 'Undo: Reminder 1 day before Training' }),
    );
    expect(await within(lines).findByText('Undone: Reminder 1 day before Training')).toBeVisible();
  });

  it('the item page shows the note it came from and its receipt', async () => {
    const { ev } = await seed();
    const user = userEvent.setup();
    renderAt(`/library/item/${ev.id}`);
    const from = await screen.findByRole('list', { name: 'From your note' });
    expect(within(from).getByText('Training on Tuesday. Remind me the day before')).toBeVisible();
    await user.click(await within(from).findByText('What Airhead did'));
    expect(within(from).getByText('Reminder 1 day before Training')).toBeVisible();
  });

  it('the Inbox shows the receipt of a capture still waiting', async () => {
    await seed();
    const user = userEvent.setup();
    renderAt('/inbox');
    const list = await screen.findByRole('list', { name: 'Unsorted' });
    await user.click(await within(list).findByText('What Airhead did'));
    expect(within(list).getByText(/^Waiting for AI sorting/)).toBeVisible();
  });
});
