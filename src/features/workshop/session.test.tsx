import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { LOCAL_USER_ID, localServices } from '../../lib/auth/localAuth';
import type { WorkshopService } from '../../lib/auth/types';
import { DataProvider } from '../../lib/db/DataProvider';
import { openUserDb } from '../../lib/db/db';
import { getPending } from '../../lib/workshop/pending';
import { AppLockProvider } from '../applock/AppLockProvider';
import SessionPanel from './SessionPanel';

const U = LOCAL_USER_ID;
const ITEM = '33333333-3333-4333-8333-333333333333';
const db = () => openUserDb(U);
const CONTENT = { summary: 'A shed.', sections: [], open_questions: [], next_steps: [] };

function fakeWorkshop() {
  const answers: (string | null)[] = [];
  const turns: { role: 'airhead' | 'me'; text: string; at: string }[] = [];
  const service: WorkshopService = {
    fleshOut: () => Promise.reject(new Error('not used')),
    turn: (itemId, answer) => {
      answers.push(answer);
      const at = new Date().toISOString();
      if (answer) turns.push({ role: 'me', text: answer, at });
      turns.push({ role: 'airhead', text: `Question ${answers.length}?`, at });
      const base = {
        user_id: U,
        created_at: at,
        updated_at: at,
        server_updated_at: at,
        deleted_at: null,
      };
      return Promise.resolve({
        ok: true,
        error_code: null,
        message: 'Updated.',
        draft: {
          ...base,
          id: crypto.randomUUID(),
          item_id: itemId,
          version: answers.length,
          content: CONTENT,
          source: 'session',
        },
        session: { ...base, id: itemId, turns: [...turns], pending: null },
      });
    },
  };
  return { service, answers };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function renderPanel(service: WorkshopService) {
  render(
    <AuthProvider services={{ ...localServices(), workshop: service }}>
      <DataProvider userId={U}>
        <AppLockProvider>
          <SessionPanel itemId={ITEM} />
        </AppLockProvider>
      </DataProvider>
    </AuthProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await db().delete();
  setOnline(true);
});

describe('Work on it together (Task 7.7)', () => {
  it('starts with questions, then each answer gets the next ones', async () => {
    const { service, answers } = fakeWorkshop();
    renderPanel(service);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Question 1?')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your answer'), 'About 2 by 3 metres');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Question 2?')).toBeInTheDocument();
    expect(screen.getByText('About 2 by 3 metres')).toBeInTheDocument();
    expect(answers).toEqual([null, 'About 2 by 3 metres']);
    const d = db();
    expect(await d.drafts.count()).toBe(2);
    d.close();
  });

  it('an answer typed offline waits, then is sent when back online', async () => {
    const { service, answers } = fakeWorkshop();
    renderPanel(service);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await screen.findByText('Question 1?');

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    await user.type(screen.getByLabelText('Your answer'), 'Timber');
    await user.click(screen.getByRole('button', { name: 'Save for later' }));
    expect(await screen.findByText('Waiting to send when you’re online')).toBeInTheDocument();
    const d = db();
    expect((await getPending(d, ITEM))?.text).toBe('Timber');
    expect(answers).toEqual([null]);

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('Question 2?')).toBeInTheDocument();
    expect(answers).toEqual([null, 'Timber']);
    await waitFor(async () => expect(await getPending(d, ITEM)).toBeNull());
    d.close();
  });
});
