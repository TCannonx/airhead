import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord } from '../../lib/db/repository';
import { patternsFrom } from '../../lib/review/patterns';
import type { Review } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';
import Patterns from './Patterns';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const hours = (h: number, n: number) => Array.from({ length: 24 }, (_, i) => (i === h ? n : 0));

const review = (week: string, over: Record<string, unknown> = {}): Review => ({
  ...baseRecord(U),
  week_start: week,
  status: 'ok',
  digest: null,
  cost_eur: 0,
  content: {
    stats: {
      tasks: { due: 5, done: 4, carried: 1 },
      completion_weekdays: [2, 1, 0, 0, 1, 0, 0],
      capture_hours: hours(22, 3),
      completion_hours: hours(9, 4),
      notifications: { sent: 6 },
      slipping_topics: [{ topic: 'House', count: 2 }],
      returning_ideas: [{ title: 'Garden office', returns: 1 }],
      ...over,
    },
  },
});

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('Patterns (Task 8.6)', () => {
  it('adds up the weekly digests, oldest week first, ignoring bad data', () => {
    const p = patternsFrom([
      review('2026-07-13'),
      review('2026-07-06', {
        completion_weekdays: 'nonsense',
        tasks: { done: 2, due: 2, carried: 3 },
      }),
      { ...review('2026-06-29'), deleted_at: '2026-07-01T00:00:00Z' },
    ]);
    expect(p.weeks).toBe(2);
    expect(p.completionWeekdays).toEqual([2, 1, 0, 0, 1, 0, 0]);
    expect(p.captureHours[22]).toBe(6);
    expect(p.perWeek.map((w) => [w.week, w.carried])).toEqual([
      ['2026-07-06', 3],
      ['2026-07-13', 1],
    ]);
    expect(p.slippingTopics).toEqual([{ topic: 'House', count: 4 }]);
    expect(p.returningIdeas).toEqual([{ title: 'Garden office', returns: 2 }]);
  });

  it('shows charts with a table view, and waits for the first review', async () => {
    const d = db();
    await d.reviews.bulkPut([review('2026-07-13'), review('2026-07-06')]);
    d.close();
    render(
      <AuthProvider services={localServices()}>
        <DataProvider userId={U}>
          <AppLockProvider>
            <Patterns />
          </AppLockProvider>
        </DataProvider>
      </AuthProvider>,
    );
    expect(
      await screen.findByText(/Over the last 2 weeks: 8 tasks done \(80% of those due\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'When you capture: highest 22:00 (6)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Tasks done by weekday: highest Mon (4)' }),
    ).toBeInTheDocument();
    const toggle = screen.getAllByRole('button', { name: 'Show as table' })[0];
    if (toggle) await userEvent.setup().click(toggle);
    expect(screen.getByRole('table', { name: 'Tasks done by weekday' })).toHaveTextContent('Mon4');
    expect(screen.getByText('House')).toBeInTheDocument();
  });
});
