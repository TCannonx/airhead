import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { AppLockProvider } from '../applock/AppLockProvider';
import NextSteps from './NextSteps';

const U = LOCAL_USER_ID;
const IDEA = '44444444-4444-4444-8444-444444444444';
const db = () => openUserDb(U);
const tasks = async () => {
  const d = db();
  const all = await d.items.where('type').equals('task').toArray();
  d.close();
  return all;
};

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('next steps to tasks (Task 7.8)', () => {
  it('all ticked; one tap adds them, linked to the idea; unticked ones are skipped', async () => {
    render(
      <AuthProvider services={localServices()}>
        <DataProvider userId={U}>
          <AppLockProvider>
            <NextSteps itemId={IDEA} steps={['Measure the wall', 'Price timber', 'Ask Sam']} />
          </AppLockProvider>
        </DataProvider>
      </AuthProvider>,
    );
    const user = userEvent.setup();
    const boxes = await screen.findAllByRole('checkbox');
    for (const b of boxes) expect(b).toBeChecked();
    expect(await tasks()).toEqual([]);

    await user.click(screen.getByRole('checkbox', { name: /Ask Sam/ }));
    await user.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Added 2 tasks.');
    const made = await tasks();
    expect(made.map((t) => t.title).sort()).toEqual(['Measure the wall', 'Price timber']);
    for (const t of made) expect(t.data.idea_id).toBe(IDEA);
    await waitFor(() => expect(screen.getAllByText('Task added')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Add 0 tasks' })).toBeDisabled();
  });
});
