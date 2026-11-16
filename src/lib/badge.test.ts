import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBadge, badgeCount } from './badge';
import { openUserDb } from './db/db';
import { baseRecord, newItem, save } from './db/repository';
import { followUpSchema } from './schemas/records';

const U = '11111111-1111-4111-8111-1111111111b1';
afterEach(async () => {
  await openUserDb(U).delete();
});

describe('app badge (Task 15.5)', () => {
  it('counts overdue tasks and open questions', async () => {
    const d = openUserDb(U);
    const now = new Date('2026-11-18T12:00:00Z');
    await save(
      d,
      'items',
      newItem(U, { type: 'task', title: 'Late', due_at: '2026-11-17T09:00:00Z' }),
    );
    await save(
      d,
      'items',
      newItem(U, { type: 'task', title: 'Later', due_at: '2026-11-19T09:00:00Z' }),
    );
    await save(
      d,
      'items',
      newItem(U, { type: 'task', title: 'Done', status: 'done', due_at: '2026-11-10T09:00:00Z' }),
    );
    await save(
      d,
      'follow_ups',
      followUpSchema.parse({
        ...baseRecord(U),
        capture_id: null,
        note_id: null,
        item_id: null,
        question: 'Who?',
        options: [],
        status: 'open',
        answer: null,
        round: 1,
      }),
    );
    expect(await badgeCount(d, now)).toBe(2);
    d.close();
  });

  it('sets, clears, or does nothing without the Badging API', async () => {
    const setAppBadge = vi.fn(() => Promise.resolve());
    const clearAppBadge = vi.fn(() => Promise.resolve());
    const nav = { setAppBadge, clearAppBadge } as unknown as Navigator;
    expect(await applyBadge(3, nav)).toBe(true);
    expect(setAppBadge).toHaveBeenCalledWith(3);
    expect(await applyBadge(0, nav)).toBe(true);
    expect(clearAppBadge).toHaveBeenCalled();
    expect(await applyBadge(3, {} as Navigator)).toBe(false);
  });
});
