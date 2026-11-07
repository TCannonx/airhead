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

function renderInbox() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/inbox'] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

/** What an AI batch leaves behind for an unsure capture. */
async function seedUnsure() {
  const d = db();
  const capture = await save(
    d,
    'captures',
    newCapture(U, { text: 'garden thing', status: 'needs_review' }),
  );
  const item = await save(
    d,
    'items',
    newItem(U, {
      type: 'idea',
      title: 'Garden thing',
      status: 'suggested',
      confidence: 0.4,
      capture_id: capture.id,
    }),
  );
  d.close();
  return { capture, item };
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Inbox → Needs a tap', () => {
  it('shows unsure items with one-tap choices, not the capture in Unsorted', async () => {
    await seedUnsure();
    renderInbox();
    const review = await screen.findByRole('list', { name: 'Needs a tap' });
    expect(within(review).getByText('Garden thing')).toBeVisible();
    expect(within(review).getByRole('button', { name: 'Keep as Idea' })).toBeVisible();
    expect(within(review).getByRole('button', { name: 'Task' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Unsorted' })).toHaveTextContent('');
  });

  it('keeping the type confirms it: no correction, capture sorted', async () => {
    const { capture, item } = await seedUnsure();
    renderInbox();
    const review = await screen.findByRole('list', { name: 'Needs a tap' });
    await userEvent.click(within(review).getByRole('button', { name: 'Keep as Idea' }));

    await waitFor(async () => expect((await db().items.get(item.id))?.status).toBe('open'));
    expect((await db().items.get(item.id))?.type).toBe('idea');
    expect(await db().corrections.count()).toBe(0);
    expect((await db().captures.get(capture.id))?.status).toBe('sorted');
  });

  it('picking another type re-sorts it and records a correction for future batches', async () => {
    const { capture, item } = await seedUnsure();
    renderInbox();
    const review = await screen.findByRole('list', { name: 'Needs a tap' });
    await userEvent.click(within(review).getByRole('button', { name: 'Task' }));

    await waitFor(async () => expect((await db().items.get(item.id))?.type).toBe('task'));
    expect((await db().items.get(item.id))?.status).toBe('open');
    const [c] = await db().corrections.toArray();
    expect(c).toMatchObject({
      capture_id: capture.id,
      from_value: { type: 'idea' },
      to_value: { type: 'task' },
    });
    expect((await db().captures.get(capture.id))?.status).toBe('sorted');
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Needs a tap' })).not.toBeInTheDocument(),
    );
  });

  it('a capture stays in review until its last unsure item is settled', async () => {
    const { capture, item } = await seedUnsure();
    const d = db();
    await save(
      d,
      'items',
      newItem(U, {
        type: 'note',
        title: 'Second guess',
        status: 'suggested',
        capture_id: capture.id,
      }),
    );
    d.close();
    renderInbox();
    const review = await screen.findByRole('list', { name: 'Needs a tap' });
    await userEvent.click(
      within(review).getAllByRole('button', { name: /^Keep as/ })[0] as HTMLElement,
    );
    await waitFor(async () => {
      const resolved = (await db().items.toArray()).filter((i) => i.status === 'open');
      expect(resolved).toHaveLength(1);
    });
    expect((await db().captures.get(capture.id))?.status).toBe('needs_review');
    expect(item.id).toBeTruthy();
  });

  it('date suggestions stay on Today, not here', async () => {
    const d = db();
    await save(d, 'items', newItem(U, { type: 'event', title: 'Call Mark', status: 'suggested' }));
    d.close();
    renderInbox();
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    expect(screen.queryByRole('list', { name: 'Needs a tap' })).not.toBeInTheDocument();
  });
});
