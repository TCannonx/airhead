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
import { undoAction } from '../../lib/db/aiActions';
import { baseRecord, newCapture, newItem, save } from '../../lib/db/repository';
import { aiActionSchema, followUpSchema, type FollowUp } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const NOTE =
  'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder';

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

/** A sorted capture, its event, and an open question about the event. */
async function seed(o: Partial<FollowUp> = {}) {
  const d = db();
  const cap = await save(d, 'captures', newCapture(U, { text: NOTE, status: 'sorted' }));
  const ev = await save(
    d,
    'items',
    newItem(U, { type: 'event', title: 'Christmas sandwiches', capture_id: cap.id }),
  );
  const f = await save(
    d,
    'follow_ups',
    followUpSchema.parse({
      ...baseRecord(U),
      capture_id: cap.id,
      note_id: null,
      item_id: ev.id,
      question: 'Who are the sandwiches for?',
      options: ['Family', 'Work', 'Friends'],
      status: 'open',
      answer: null,
      round: 1,
      ...o,
    }),
  );
  d.close();
  return { cap, ev, f };
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Questions for you (Task 12.2)', () => {
  it('shows the question, the note it came from and quick answers; a quick answer becomes a linked capture', async () => {
    const { ev, f } = await seed();
    const user = userEvent.setup();
    renderAt('/inbox');
    const list = await screen.findByRole('list', { name: 'Questions for you' });
    expect(within(list).getByText('Who are the sandwiches for?')).toBeVisible();
    expect(within(list).getByText(`From “${NOTE}”`)).toBeVisible();
    await user.click(within(list).getByRole('button', { name: 'Work' }));
    expect(
      await screen.findByText('Thanks. Airhead will use that the next time it sorts.'),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Questions for you' })).toBeNull(),
    );

    const d = db();
    const row = await d.follow_ups.get(f.id);
    expect([row?.status, row?.answer]).toEqual(['answered', 'Work']);
    const answer = (await d.captures.toArray()).find((c) => c.payload.follow_up_id === f.id);
    expect(answer?.text).toBe('Work');
    expect(answer?.status).toBe('unsorted');
    expect(answer?.payload).toMatchObject({
      question: 'Who are the sandwiches for?',
      item_id: ev.id,
      round: 1,
    });
    expect(await d.outbox.where('table').equals('follow_ups').count()).toBeGreaterThan(0);
    d.close();
  });

  it('a typed answer is sent; an empty one cannot be', async () => {
    const { f } = await seed({ options: [] });
    const user = userEvent.setup();
    renderAt('/inbox');
    const send = await screen.findByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.type(
      screen.getByLabelText('Answer: Who are the sandwiches for?'),
      'The office team',
    );
    await user.click(send);
    await screen.findByText('Thanks. Airhead will use that the next time it sorts.');
    const d = db();
    expect((await d.follow_ups.get(f.id))?.answer).toBe('The office team');
    d.close();
  });

  it('Dismiss closes the question and records a correction', async () => {
    const { cap, f } = await seed();
    const user = userEvent.setup();
    renderAt('/inbox');
    await user.click(
      await screen.findByRole('button', { name: 'Dismiss: Who are the sandwiches for?' }),
    );
    await screen.findByText('Dismissed. Airhead will ask less like that.');
    const d = db();
    expect((await d.follow_ups.get(f.id))?.status).toBe('dismissed');
    const [corr] = await d.corrections.toArray();
    expect(corr?.capture_id).toBe(cap.id);
    expect(corr?.to_value).toEqual({ follow_up: 'dismissed', reason: 'not useful' });
    expect(await d.captures.count()).toBe(1);
    d.close();
  });

  it('the item shows its open questions, and Today shows a card while any are open', async () => {
    const { ev } = await seed();
    renderAt(`/library/item/${ev.id}`);
    const list = await screen.findByRole('list', { name: 'Questions about this' });
    expect(within(list).getByText('Who are the sandwiches for?')).toBeVisible();
    expect(within(list).queryByText(/^From /)).toBeNull();
  });

  it('Today: "Airhead has N questions" links to the Inbox; nothing when none are open', async () => {
    await seed();
    await seed({ question: 'How many people?' });
    renderAt('/today');
    const card = await screen.findByRole('link', { name: /Airhead has 2 questions/ });
    expect(card).toHaveAttribute('href', '/inbox');
  });

  it('Today shows no card with no open questions', async () => {
    await seed({ status: 'answered', answer: 'Work' });
    renderAt('/today');
    await screen.findByRole('link', { name: 'Evening review' });
    expect(screen.queryByText(/Airhead has/)).toBeNull();
  });

  it('Undo of an answer added to an item restores its details', async () => {
    const d = db();
    const item = await save(
      d,
      'items',
      newItem(U, { type: 'event', title: 'Christmas sandwiches', body: null }),
    );
    const a = await save(
      d,
      'ai_actions',
      aiActionSchema.parse({
        ...baseRecord(U),
        capture_id: null,
        kind: 'tidy_item',
        status: 'applied',
        reason: null,
        summary: 'Added your answer to “Christmas sandwiches”',
        quote: 'Work',
        confidence: 1,
        payload: {},
        target_table: 'items',
        target_id: item.id,
        before: { body: null },
        after: { body: 'Who are the sandwiches for? Work' },
      }),
    );
    await save(d, 'items', { ...item, body: 'Who are the sandwiches for? Work' });
    expect(await undoAction(d, U, a)).toBe('undone');
    expect((await d.items.get(item.id))?.body).toBeNull();
    d.close();
  });
});
