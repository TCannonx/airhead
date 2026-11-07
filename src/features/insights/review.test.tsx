import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { ReviewsService } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { createNote, saveDoc } from '../../lib/db/notes';
import { baseRecord, newItem, save } from '../../lib/db/repository';
import { filterLibrary } from '../../lib/db/sorting';
import { AppLockProvider } from '../applock/AppLockProvider';
import WeeklyReview from './WeeklyReview';

const U = LOCAL_USER_ID;
const DEVICE = '22222222-2222-4222-8222-222222222222';
const db = () => openUserDb(U);

/** Buttons are off while an action runs; wait until this one is on, then tap it. */
async function tap(user: ReturnType<typeof userEvent.setup>, name: string) {
  const b = await screen.findByRole('button', { name });
  await waitFor(() => expect(b).toBeEnabled());
  await user.click(b);
}

async function seed() {
  const d = db();
  const oldNote = await save(d, 'items', newItem(U, { type: 'task', title: 'Old receipt' }));
  const dupe = await save(d, 'items', newItem(U, { type: 'reading', title: 'Same article' }));
  const keep = await save(d, 'items', newItem(U, { type: 'idea', title: 'Boat trip' }));
  const a = await createNote(d, U, DEVICE, { type: 'note', kind: 'typed', title: 'Shed ideas' });
  await saveDoc(d, DEVICE, a.item.id, { html: '<p>Timber, 2 by 3</p>' });
  const b = await createNote(d, U, DEVICE, { type: 'note', kind: 'typed', title: 'Shed costs' });
  await saveDoc(d, DEVICE, b.item.id, { html: '<p>About €500</p>' });
  const f1 = await save(d, 'memory_facts', {
    ...baseRecord(U),
    text: 'Cycles to work',
    category: 'everyday',
    status: 'active',
    source_capture_id: null,
    last_used_at: null,
  });
  const f2 = await save(d, 'memory_facts', {
    ...f1,
    ...baseRecord(U),
    text: 'Bikes to the office',
  });
  const f3 = await save(d, 'memory_facts', {
    ...f1,
    ...baseRecord(U),
    text: 'Training on Mondays',
  });
  const p = (
    id: string,
    title: string,
    proposal: string,
    item_type: string,
    group: number | null = null,
  ) => ({
    kind: 'item',
    id,
    title,
    item_type,
    proposal,
    reason: 'test',
    group,
  });
  await d.reviews.put({
    ...baseRecord(U),
    week_start: '2026-07-13',
    status: 'ok',
    content: {
      themes: ['House jobs'],
      wins: ['Tax form done'],
      slipped: ['Gutter'],
      suggestions: ['Block Saturday morning'],
      tidy: [
        p(oldNote.id, 'Old receipt', 'archive', 'task'),
        p(dupe.id, 'Same article', 'delete', 'reading'),
        p(keep.id, 'Boat trip', 'keep', 'idea'),
        p(a.item.id, 'Shed ideas', 'condense', 'note', 1),
        p(b.item.id, 'Shed costs', 'condense', 'note', 1),
      ],
      auto_done: [{ kind: 'item', id: 'x', title: 'Gone', reason: 'done_old' }],
      facts: [
        { action: 'merge', ids: [f1.id, f2.id], text: 'Cycles to work most days' },
        { action: 'retire', ids: [f3.id], text: null },
      ],
      ai: { cost_eur: 0.12, calls: 20 },
      stats: {},
    },
    digest: 'A busy week.',
    cost_eur: 0.03,
  });
  d.close();
  return { oldNote, dupe, keep, a: a.item, b: b.item, f1, f2, f3 };
}

function renderReview(reviews?: ReviewsService) {
  render(
    <MemoryRouter>
      <AuthProvider services={{ ...localServices(), reviews }}>
        <DataProvider userId={U}>
          <AppLockProvider>
            <WeeklyReview />
          </AppLockProvider>
        </DataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('weekly review page (Task 8.4)', () => {
  it('shows the review; Tidy-up proposals only happen on a tap', async () => {
    const s = await seed();
    renderReview();
    const user = userEvent.setup();
    expect(await screen.findByText('House jobs')).toBeInTheDocument();
    expect(screen.getByText(/AI this week: €0\.12 over 20 calls/)).toBeInTheDocument();
    expect(screen.getByText(/Tidied for you: 1 old or duplicate item/)).toBeInTheDocument();

    let d = db();
    expect((await d.items.get(s.oldNote.id))?.data.archived).toBeUndefined();
    d.close();

    await tap(user, 'Archive Old receipt');
    await tap(user, 'Delete Same article');
    await tap(user, 'Keep Boat trip');
    await waitFor(() => expect(screen.getByText('Kept')).toBeInTheDocument());
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('In the Trash')).toBeInTheDocument();

    d = db();
    const items = await d.items.toArray();
    expect(items.find((i) => i.id === s.oldNote.id)?.data.archived).toBe(true);
    expect(items.find((i) => i.id === s.dupe.id)?.deleted_at).not.toBeNull();
    expect(items.find((i) => i.id === s.keep.id)?.data.keep).toBe(true);
    // Archived items leave the Library lists (search still finds them).
    expect(
      filterLibrary(items, { type: null, topicId: '', from: '', to: '' }).map((i) => i.id),
    ).not.toContain(s.oldNote.id);
    d.close();
  });

  it('condense merges notes into one with a dated timeline and archives them', async () => {
    const s = await seed();
    renderReview();
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Condense 2 into one note' }));
    await waitFor(async () => {
      const d = db();
      const merged = (await d.items.toArray()).find((i) => Array.isArray(i.data.condensed_from));
      const doc = merged && (await d.note_docs.get(merged.id));
      d.close();
      expect(String(doc?.doc.html)).toMatch(
        /— Shed ideas<\/h2><p>Timber, 2 by 3<\/p><h2>.*— Shed costs/,
      );
    });
    const d = db();
    const [a, b] = await d.items.bulkGet([s.a.id, s.b.id]);
    d.close();
    expect([a?.data.archived, b?.data.archived]).toEqual([true, true]);
    expect(typeof a?.data.condensed_into).toBe('string');
    await waitFor(() => expect(screen.getAllByText('Condensed')).toHaveLength(2));
  });

  it('memory changes apply on a tap', async () => {
    const s = await seed();
    renderReview();
    const user = userEvent.setup();
    await tap(user, 'Merge');
    await tap(user, 'Retire');
    await waitFor(async () => {
      const d = db();
      const [f1, f2, f3] = await d.memory_facts.bulkGet([s.f1.id, s.f2.id, s.f3.id]);
      d.close();
      expect(f1?.text).toBe('Cycles to work most days');
      expect(f2?.deleted_at).not.toBeNull();
      expect(f3?.status).toBe('archived');
    });
  });

  it('with no review yet, Run now asks the server', async () => {
    const calls: number[] = [];
    renderReview({
      run: () => {
        calls.push(1);
        return Promise.resolve({ ok: true, message: 'Weekly review ready.' });
      },
    });
    expect(await screen.findByText(/first weekly review arrives/)).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Run the weekly review now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Weekly review ready.');
    expect(calls).toEqual([1]);
  });
});
