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
import { newItem, save } from '../../lib/db/repository';
import { AppLockProvider } from '../applock/AppLockProvider';

const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Element.prototype.getClientRects ??= rects;
Range.prototype.getClientRects ??= rects;
document.elementFromPoint ??= () => null;

const U = LOCAL_USER_ID;
const EVENT = '00000000-0000-4000-8000-0000000000e1';
const db = () => openUserDb(U);

function renderAt(path: string) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T08:00:00Z'));
  localStorage.clear();
  await db().delete();
  const d = db();
  await save(d, 'items', {
    ...newItem(U, {
      type: 'event',
      title: 'Project kickoff',
      calendar: 'personal',
      start_at: '2026-07-15T13:00:00.000Z',
      end_at: '2026-07-15T14:00:00.000Z',
    }),
    id: EVENT,
  });
  d.close();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('meeting notes from events (Task 6.4)', () => {
  it('"Start notes" on today’s event makes a linked meeting note; then it opens it', async () => {
    const user = userEvent.setup();
    const router = renderAt('/today');
    const events = await screen.findByRole('list', { name: "Today's events" });
    await user.click(
      await within(events).findByRole('button', { name: 'Start notes: Project kickoff' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/notes\//));
    const noteId = router.state.location.pathname.split('/')[2] ?? '';

    expect(await screen.findByLabelText('Title')).toHaveValue('Project kickoff');
    const details = screen.getByLabelText('Meeting details');
    expect(within(details).getByLabelText('Date')).toHaveValue('2026-07-15');
    await user.type(within(details).getByLabelText('Attendees'), 'Aoife, Mark ');
    await user.tab();
    await waitFor(async () => {
      const x = db();
      const note = await x.items.get(noteId);
      x.close();
      expect(note?.data).toMatchObject({
        event_id: EVENT,
        meeting_date: '2026-07-15',
        attendees: ['Aoife', 'Mark'],
      });
    });

    // Back on Today, the event now opens the same note.
    await router.navigate('/today');
    const again = await screen.findByRole('list', { name: "Today's events" });
    await user.click(
      await within(again).findByRole('button', { name: 'Open notes: Project kickoff' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe(`/notes/${noteId}`));
    const x = db();
    expect(await x.items.where('type').equals('meeting').count()).toBe(1);
    x.close();
  });
});
