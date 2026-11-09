import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import { notesHandled } from '../../lib/ai/notesHandled';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord, newCapture, newItem, save } from '../../lib/db/repository';
import { followUpSchema, type FollowUp } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

const question = (o: Partial<FollowUp>): FollowUp =>
  followUpSchema.parse({
    ...baseRecord(U),
    capture_id: null,
    note_id: null,
    item_id: null,
    question: 'Who is it for?',
    options: [],
    status: 'open',
    answer: null,
    round: 1,
    ...o,
  });

/** Four sorted captures (an item, a question, nothing, failed) and one waiting. */
async function seed() {
  const d = db();
  const withItem = await save(d, 'captures', newCapture(U, { text: 'buy milk', status: 'sorted' }));
  await save(d, 'items', newItem(U, { type: 'task', title: 'Buy milk', capture_id: withItem.id }));
  const asked = await save(
    d,
    'captures',
    newCapture(U, { text: 'party planning', status: 'sorted' }),
  );
  await save(d, 'follow_ups', question({ capture_id: asked.id }));
  await save(d, 'follow_ups', question({ capture_id: asked.id, status: 'answered', answer: 'Me' }));
  await save(d, 'follow_ups', question({ capture_id: asked.id, status: 'dismissed' }));
  await save(d, 'captures', newCapture(U, { text: 'just a thought', status: 'sorted' }));
  await save(d, 'captures', newCapture(U, { text: 'garbled', status: 'failed' }));
  await save(d, 'captures', newCapture(U, { text: 'call mum' }));
  await save(d, 'corrections', {
    ...baseRecord(U),
    capture_id: asked.id,
    from_value: { follow_up: 'Who is it for?' },
    to_value: { follow_up: 'dismissed', reason: 'not useful' },
  });
  d.close();
}

function renderInsights() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/insights'] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Notes handled (Task 12.5)', () => {
  it('counts handled, waiting and not acted on, questions by status, and the correction rate', async () => {
    await seed();
    const d = db();
    const n = notesHandled({
      captures: await d.captures.toArray(),
      items: await d.items.toArray(),
      actions: await d.ai_actions.toArray(),
      followUps: await d.follow_ups.toArray(),
      corrections: await d.corrections.toArray(),
    });
    d.close();
    expect([n.total, n.handled, n.waiting]).toEqual([5, 2, 1]);
    expect(n.notActedOn.map((c) => c.text).sort()).toEqual(['garbled', 'just a thought']);
    expect(n.questions).toEqual({ open: 1, answered: 1, dismissed: 1 });
    expect([n.corrections, n.itemsSorted, n.correctionRate]).toEqual([1, 1, 1]);
  });

  it('Insights shows the tiles, and "Not acted on" opens into the list', async () => {
    await seed();
    const user = userEvent.setup();
    renderInsights();
    const block = await screen.findByRole('region', { name: 'Notes handled' });
    expect(await within(block).findByText('2 of 5')).toBeVisible();
    expect(within(block).getByText('1 open')).toBeVisible();
    expect(within(block).getByText('1 answered, 1 dismissed')).toBeVisible();
    await user.click(within(block).getByText('Not acted on: 2'));
    const list = within(block).getByRole('list', { name: 'Not acted on' });
    expect(within(list).getByText('just a thought')).toBeVisible();
    expect(within(list).getByText('Sorting could not read it.')).toBeVisible();
  });

  it('nothing dropped says so', async () => {
    renderInsights();
    const block = await screen.findByRole('region', { name: 'Notes handled' });
    expect(await within(block).findByText('Not acted on: 0. Nothing was dropped.')).toBeVisible();
  });
});
