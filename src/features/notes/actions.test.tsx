import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { createNote } from '../../lib/db/notes';
import { AppLockProvider } from '../applock/AppLockProvider';
import ActionItems from './ActionItems';

const U = LOCAL_USER_ID;
const DEVICE = '22222222-2222-4222-8222-222222222222';
const db = () => openUserDb(U);

const ACTIONS = [
  { title: 'Book the room', owner: 'Mark', due_text: 'Friday' },
  { title: 'Send agenda', owner: null, due_text: null },
  { title: 'Order cake', owner: null, due_text: 'tomorrow' },
];

const tasks = async () => {
  const d = db();
  const all = await d.items.where('type').equals('task').toArray();
  d.close();
  return all;
};

async function setup() {
  const d = db();
  const { item } = await createNote(d, U, DEVICE, {
    type: 'meeting',
    kind: 'typed',
    title: 'Sync',
  });
  d.close();
  render(
    <AuthProvider services={localServices()}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <ActionItems note={item} actions={ACTIONS} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
  return item;
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
});

describe('action items to tasks (Task 6.8)', () => {
  it('starts all unticked; nothing is created without a tap', async () => {
    await setup();
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    for (const b of boxes) expect(b).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Add as task' })).toBeDisabled();
    expect(await tasks()).toEqual([]);
  });

  it('only ticked items become tasks, linked to the note, with parsed due dates', async () => {
    const note = await setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /Book the room/ }));
    await user.click(screen.getByRole('checkbox', { name: /Order cake/ }));
    await user.click(screen.getByRole('button', { name: 'Add 2 as tasks' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Added 2 tasks.');
    const made = await tasks();
    expect(made.map((t) => t.title).sort()).toEqual(['Book the room', 'Order cake']);
    for (const t of made) {
      expect(t.data.note_id).toBe(note.id);
      expect(t.due_at).not.toBeNull();
    }
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Book the room/ })).toBeDisabled(),
    );
    expect(screen.getAllByText('Task added')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: /Send agenda/ })).not.toBeChecked();
  });
});
