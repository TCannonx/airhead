import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import type { EventDraft } from './EventEditor';
import QuickAdd from './QuickAdd';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const items = async () => {
  const d = db();
  const all = await d.items.toArray();
  d.close();
  return all;
};

function renderQuickAdd(onMore = vi.fn()) {
  render(
    <MemoryRouter>
      <AuthProvider services={localServices()}>
        <DataProvider userId={U}>
          <QuickAdd timeZone="Europe/Dublin" onMore={onMore} />
        </DataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return onMore;
}

beforeEach(async () => {
  await db().delete();
  vi.useFakeTimers({ toFake: ['Date'] });
  // Monday 9 November 2026, 10:00 in Dublin.
  vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
  return () => vi.useRealTimers();
});

describe('quick add (Task 11.4)', () => {
  it('shows a live preview, then Enter saves the event', async () => {
    const user = userEvent.setup();
    renderQuickAdd();
    await user.type(
      await screen.findByRole('textbox', { name: 'Quick add' }),
      'Quiz every Thursday 8pm-12pm',
    );
    const preview = screen.getByRole('group', { name: 'Quick add preview' });
    expect(preview).toHaveTextContent('Quiz');
    expect(preview).toHaveTextContent('Thu 12 Nov 2026, 20:00–00:00');
    expect(preview).toHaveTextContent('Every Thursday · Personal');

    await user.keyboard('{Enter}');
    await waitFor(async () =>
      expect(await items()).toEqual([
        expect.objectContaining({
          type: 'event',
          title: 'Quiz',
          status: 'open',
          calendar: 'personal',
          start_at: '2026-11-12T20:00:00.000Z',
          end_at: '2026-11-13T00:00:00.000Z',
          rrule: 'FREQ=WEEKLY;BYDAY=TH',
        }),
      ]),
    );
    expect(screen.getByRole('textbox', { name: 'Quick add' })).toHaveValue('');
    expect(screen.queryByRole('group', { name: 'Quick add preview' })).not.toBeInTheDocument();
  });

  it('a birthday is all day and yearly; More options opens the form filled in', async () => {
    const user = userEvent.setup();
    const onMore = renderQuickAdd();
    await user.type(
      await screen.findByRole('textbox', { name: 'Quick add' }),
      "Niamh's birthday 11/11 every year",
    );
    const preview = screen.getByRole('group', { name: 'Quick add preview' });
    expect(preview).toHaveTextContent('Wed 11 Nov 2026 · All day');
    expect(preview).toHaveTextContent('Every year on 11 Nov');
    await user.click(within(preview).getByRole('button', { name: 'More options' }));
    const draft = onMore.mock.calls[0]?.[0] as EventDraft;
    expect(draft).toMatchObject({ title: "Niamh's birthday", allDay: true, rrule: 'FREQ=YEARLY' });
    expect(draft.start.toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(draft.end?.toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(await items()).toEqual([]);
  });

  it('text with no date says so and uses the next hour', async () => {
    const user = userEvent.setup();
    renderQuickAdd();
    await user.type(await screen.findByRole('textbox', { name: 'Quick add' }), 'Call mam');
    expect(screen.getByRole('group', { name: 'Quick add preview' })).toHaveTextContent(
      'Mon 9 Nov 2026, 11:00–12:00 (no date found)',
    );
  });
});
