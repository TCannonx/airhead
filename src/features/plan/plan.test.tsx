import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { NudgesService } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord, newItem, save } from '../../lib/db/repository';
import { snoozeChoices, sourceLabel } from '../../lib/plan/plan';
import { itemPlanSchema, nudgeSchema, type Nudge } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

function renderAt(path: string, nudges?: NudgesService) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider services={{ ...localServices(), ...(nudges ? { nudges } : {}) }}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={router} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
  return router;
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function nudge(itemId: string, over: Partial<Nudge> = {}): Nudge {
  return nudgeSchema.parse({
    ...baseRecord(U),
    kind: 'prepare',
    item_id: itemId,
    send_at: inHours(3),
    status: 'pending',
    title: 'Pack your training bag',
    body: 'Boots',
    url: `/library/item/${itemId}`,
    dedupe_key: `plan:prepare:${itemId}:x`,
    sent_at: null,
    reason: 'Training starts at 08:00, so the evening before',
    source: 'ai',
    delivery: 'push',
    plan_run_id: null,
    outcome: null,
    outcome_at: null,
    snoozed_to: null,
    ...over,
  });
}

async function seed() {
  const d = db();
  const ev = await save(
    d,
    'items',
    newItem(U, { type: 'event', title: 'Training', start_at: inHours(14) }),
  );
  await d.item_plans.put(
    itemPlanSchema.parse({
      ...baseRecord(U),
      item_id: ev.id,
      surface_at: null,
      effort_minutes: 90,
      needs: [],
      prep: ['Training bag', 'Boots'],
      reading_slot: null,
      reason: 'Early start: pack tonight',
      confidence: 0.9,
      source: 'ai',
      plan_run_id: null,
      planned_at: new Date().toISOString(),
    }),
  );
  const prep = nudge(ev.id);
  await d.nudges.bulkPut([
    prep,
    nudge(ev.id, {
      kind: 'leave',
      title: 'Time to leave for training',
      send_at: inHours(13),
      reason: '30 min to get there plus 10 spare',
      source: 'default',
      dedupe_key: `plan:leave:${ev.id}:x`,
    }),
    // Already sent: not "upcoming".
    nudge(ev.id, { status: 'sent', title: 'Old one', dedupe_key: 'old' }),
  ]);
  d.close();
  return { ev, prep };
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('"Why now?" on the item page (Task 13.8)', () => {
  it('shows what to prepare and each upcoming reminder with its reason and source', async () => {
    const { ev } = await seed();
    renderAt(`/library/item/${ev.id}`);
    const list = await screen.findByRole('list', { name: 'Why now?' });
    expect(within(list).getByText('Prepare: Training bag, Boots')).toBeVisible();
    expect(within(list).getByText('Early start: pack tonight')).toBeVisible();
    const rows = within(list).getAllByRole('listitem');
    // Plan first, then reminders soonest first.
    expect(rows[1]).toHaveTextContent('Pack your training bag');
    expect(rows[1]).toHaveTextContent('Training starts at 08:00, so the evening before');
    expect(rows[1]).toHaveTextContent('Planned by AI');
    expect(rows[2]).toHaveTextContent('Time to leave for training');
    expect(rows[2]).toHaveTextContent('Airhead’s defaults');
    expect(within(list).queryByText(/Old one/)).toBeNull();
  });

  it('shows nothing for an item with no plan and no reminders', async () => {
    const d = db();
    const it = await save(d, 'items', newItem(U, { type: 'task', title: 'Plain' }));
    d.close();
    renderAt(`/library/item/${it.id}`);
    await screen.findByRole('heading', { name: 'Plain' });
    expect(screen.queryByRole('list', { name: 'Why now?' })).toBeNull();
  });
});

describe('The snooze sheet a notification opens (Task 13.8)', () => {
  it('snoozes to a quick choice and closes', async () => {
    const { ev, prep } = await seed();
    const respond = vi.fn<NudgesService['respond']>(() =>
      Promise.resolve({ ok: true, message: 'Snoozed.' }),
    );
    const user = userEvent.setup();
    const router = renderAt(`/library/item/${ev.id}?nudge=${prep.id}`, { respond });
    const sheet = await screen.findByRole('dialog', { name: 'Pack your training bag' });
    await user.click(within(sheet).getByRole('button', { name: /^In an hour/ }));
    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
    const [id, outcome, to] = respond.mock.calls[0] ?? [];
    expect([id, outcome]).toEqual([prep.id, 'snoozed']);
    expect(Math.abs(Date.parse(to ?? '') - Date.now() - 3_600_000)).toBeLessThan(60_000);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');
  });

  it('Done and Not needed record the outcome; a failure is shown', async () => {
    const { ev, prep } = await seed();
    const respond = vi
      .fn<NudgesService['respond']>()
      .mockResolvedValueOnce({ ok: false, message: 'You’re offline.' })
      .mockResolvedValue({ ok: true, message: 'Marked done.' });
    const user = userEvent.setup();
    renderAt(`/library/item/${ev.id}?nudge=${prep.id}`, { respond });
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Not needed' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('You’re offline.');
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(respond.mock.calls.map((c) => c[1])).toEqual(['dismissed', 'acted']);
  });

  it('a picked time in the past cannot be used', async () => {
    const { ev, prep } = await seed();
    const user = userEvent.setup();
    renderAt(`/library/item/${ev.id}?nudge=${prep.id}`, {
      respond: () => Promise.resolve({ ok: true, message: '' }),
    });
    const sheet = await screen.findByRole('dialog');
    const pick = within(sheet).getByLabelText('Pick a time');
    await user.clear(pick);
    await user.type(pick, '2020-01-01T10:00');
    expect(within(sheet).getByRole('button', { name: 'Snooze to this time' })).toBeDisabled();
  });

  it('without the server the choices are off and it says why', async () => {
    const { ev, prep } = await seed();
    renderAt(`/library/item/${ev.id}?nudge=${prep.id}`);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Snoozing needs Airhead’s server.')).toBeVisible();
    expect(within(sheet).getByRole('button', { name: 'Done' })).toBeDisabled();
  });
});

describe('snooze choices and labels', () => {
  it('offers this evening only while it is ahead, and tomorrow morning at the brief time', () => {
    const afternoon = new Date(2026, 10, 17, 15, 0);
    expect(
      snoozeChoices(afternoon, undefined).map((c) => [c.label, c.at.getHours(), c.at.getMinutes()]),
    ).toEqual([
      ['In an hour', 16, 0],
      ['This evening', 20, 30],
      ['Tomorrow morning', 7, 30],
    ]);
    const late = new Date(2026, 10, 17, 21, 0);
    expect(snoozeChoices(late, undefined).map((c) => c.label)).toEqual([
      'In an hour',
      'Tomorrow morning',
    ]);
    expect(sourceLabel('rule')).toBe('Your reminder');
  });
});
