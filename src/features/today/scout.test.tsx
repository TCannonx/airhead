import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { ScoutService } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord } from '../../lib/db/repository';
import type { Suggestion } from '../../lib/schemas/records';
import { AppLockProvider } from '../applock/AppLockProvider';
import ScoutCards from './ScoutCards';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);

const card = (over: Partial<Suggestion>): Suggestion => ({
  ...baseRecord(U),
  run_id: null,
  kind: 'web',
  title: 'Jazz at the Sugar Club',
  body: 'Friday 24 July.',
  source_url: 'https://example.ie/jazz',
  proposed: { type: 'task', title: 'Book jazz tickets' },
  status: 'open',
  ...over,
});

function renderCards(scout?: ScoutService) {
  render(
    <AuthProvider services={{ ...localServices(), scout }}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <ScoutCards />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

async function tap(user: ReturnType<typeof userEvent.setup>, name: string) {
  const b = await screen.findByRole('button', { name });
  await waitFor(() => expect(b).toBeEnabled());
  await user.click(b);
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('Scout cards (Task 8.12)', () => {
  it('nothing is created until Accept; accepting a web idea adds the task and an interest fact', async () => {
    const d = db();
    await d.suggestions.bulkPut([
      card({}),
      card({
        kind: 'free_time',
        title: 'Saturday 25 July is free for you both',
        source_url: null,
        proposed: { type: 'event', title: 'Plans together', date: '2026-07-25', all_day: true },
      }),
    ]);
    d.close();
    renderCards();
    const user = userEvent.setup();
    expect(await screen.findByText('Jazz at the Sugar Club')).toBeInTheDocument();
    let d2 = db();
    expect(await d2.items.count()).toBe(0);
    d2.close();

    await tap(user, 'Accept Jazz at the Sugar Club');
    await tap(user, 'Accept Saturday 25 July is free for you both');
    await waitFor(() => expect(screen.queryByText('Jazz at the Sugar Club')).toBeNull());

    d2 = db();
    const items = await d2.items.toArray();
    const facts = await d2.memory_facts.toArray();
    d2.close();
    expect(items.map((i) => [i.type, i.title]).sort()).toEqual([
      ['event', 'Plans together'],
      ['task', 'Book jazz tickets'],
    ]);
    expect(items.find((i) => i.type === 'event')?.all_day).toBe(true);
    // Only the web idea teaches memory.
    expect(facts.map((f) => f.text)).toEqual(['Interested in: Jazz at the Sugar Club']);
  });

  it('dismissing a web idea hides it and adds a "not interested" fact', async () => {
    const d = db();
    await d.suggestions.put(card({ title: 'Midweek concert' }));
    d.close();
    renderCards();
    await tap(userEvent.setup(), 'Dismiss Midweek concert');
    await waitFor(async () => {
      const d2 = db();
      const [s] = await d2.suggestions.toArray();
      const facts = await d2.memory_facts.toArray();
      d2.close();
      expect(s?.status).toBe('dismissed');
      expect(facts.map((f) => f.text)).toEqual(['Not interested in: Midweek concert']);
    });
    const d3 = db();
    expect(await d3.items.count()).toBe(0);
    d3.close();
  });

  it('Scout now asks the server and shows the result', async () => {
    const calls: number[] = [];
    renderCards({
      run: () => {
        calls.push(1);
        return Promise.resolve({ ok: true, message: '3 ideas ready.' });
      },
    });
    await tap(userEvent.setup(), 'Scout now');
    expect(await screen.findByRole('status')).toHaveTextContent('3 ideas ready.');
    expect(calls).toEqual([1]);
  });
});
