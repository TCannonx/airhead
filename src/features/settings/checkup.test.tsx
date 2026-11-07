import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { MemoryService, Services } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { baseRecord, save } from '../../lib/db/repository';
import { AppLockProvider } from '../applock/AppLockProvider';

const U = LOCAL_USER_ID;
const db = () => openUserDb(U);
const old = new Date(Date.now() - 120 * 86_400_000).toISOString();

function setup(path: string, memory?: MemoryService) {
  const services: Services = { ...localServices(), memory };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  render(
    <AuthProvider services={services}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

const fact = (text: string, last_used_at: string | null = new Date().toISOString()) => ({
  ...baseRecord(U),
  text,
  category: 'everyday' as const,
  status: 'active' as const,
  source_capture_id: null,
  last_used_at,
});

let ids: { stale: string; a: string; b: string };
beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  const d = db();
  const stale = await save(d, 'memory_facts', fact('Liked salsa classes', old));
  const a = await save(d, 'memory_facts', fact('Trains on Tuesdays at 7pm'));
  const b = await save(d, 'memory_facts', fact('Trains on Mondays at 7pm'));
  ids = { stale: stale.id, a: a.id, b: b.id };
  d.close();
});

describe('Memory check-up', () => {
  it('runs from Settings, lists findings and applies a one-tap fix', async () => {
    setup('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Run check-up' }));
    const findings = await screen.findByRole('list', { name: 'Check-up findings' });
    const stale = await within(findings).findByText('1 fact not used for 90 days');
    const card = stale.closest('li') as HTMLElement;
    expect(within(card).getByText(/Trims about 3 words from every call/)).toBeVisible();
    await userEvent.click(within(card).getByRole('button', { name: 'Archive 1 fact' }));
    await waitFor(async () =>
      expect((await db().memory_facts.get(ids.stale))?.status).toBe('archived'),
    );
    await waitFor(() =>
      expect(within(findings).queryByText('1 fact not used for 90 days')).not.toBeInTheDocument(),
    );
  });

  it('checks for contradictions with one AI call and merges or removes', async () => {
    const memory = {
      checkContradictions: vi.fn(async () => ({
        ok: true,
        error_code: null,
        message: 'Found 1 possible contradiction.',
        conflicts: [
          {
            fact_ids: [ids.a, ids.b] as [string, string],
            explanation: 'They give different training days.',
            merged_text: 'Trains on Mondays and Tuesdays at 7pm',
          },
        ],
      })),
    };
    setup('/settings', memory);
    await userEvent.click(await screen.findByRole('button', { name: /Check for contradictions/ }));
    const list = await screen.findByRole('list', { name: 'Contradictions' });
    expect(within(list).getByText('They give different training days.')).toBeVisible();
    await userEvent.click(
      within(list).getByRole('button', { name: 'Use “Trains on Mondays and Tuesdays at 7pm”' }),
    );
    await waitFor(async () =>
      expect((await db().memory_facts.get(ids.a))?.text).toBe(
        'Trains on Mondays and Tuesdays at 7pm',
      ),
    );
    expect((await db().memory_facts.get(ids.b))?.deleted_at).not.toBeNull();
  });

  it('runs by itself monthly on Insights and shows the last report', async () => {
    setup('/insights');
    expect(await screen.findByText(/Last check-up: today · \d+ finding/)).toBeVisible();
    const report = await db().meta.get('checkup');
    expect((report?.value as { at: string }).at).toBeTruthy();
  });

  it('no contradiction button without a server', async () => {
    setup('/settings');
    await screen.findByRole('button', { name: 'Run check-up' });
    expect(
      screen.queryByRole('button', { name: /Check for contradictions/ }),
    ).not.toBeInTheDocument();
  });
});
