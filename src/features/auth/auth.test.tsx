import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import type { AppLockAuthenticator, AuthClient, AuthUser } from '../../lib/auth/types';
import { openUserDb } from '../../lib/db/db';
import { baseRecord, save } from '../../lib/db/repository';

const noLock: AppLockAuthenticator = {
  available: async () => false,
  register: async () => 'x',
  verify: async () => {},
};

function fakeAuth(initial: AuthUser | null = null) {
  let user = initial;
  const listeners = new Set<(u: AuthUser | null) => void>();
  const set = (u: AuthUser | null) => {
    user = u;
    listeners.forEach((l) => l(u));
  };
  const client = {
    mode: 'server' as const,
    getUser: vi.fn(async () => user),
    onChange: vi.fn((cb: (u: AuthUser | null) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    signInWithGoogle: vi.fn(async () => {}),
    sendEmailCode: vi.fn(async (_email: string) => {}),
    verifyEmailCode: vi.fn(async (email: string, code: string) => {
      if (code !== '123456') throw new Error('That code is wrong or has expired.');
      set({ id: '11111111-1111-4111-8111-111111111111', email });
    }),
    signOut: vi.fn(async () => set(null)),
  } satisfies AuthClient;
  return { client, set };
}

const ME: AuthUser = { id: '11111111-1111-4111-8111-111111111111', email: 'me@example.test' };

beforeEach(async () => {
  localStorage.clear();
  await openUserDb('11111111-1111-4111-8111-111111111111').delete();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  window.history.replaceState(null, '', '/');
});

describe('sign-in', () => {
  it('shows the sign-in screen when signed out', async () => {
    const { client } = fakeAuth(null);
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);
    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).not.toBeInTheDocument();
  });

  it('starts Google sign-in from the button', async () => {
    const { client } = fakeAuth(null);
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    expect(client.signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('signs in with an emailed code', async () => {
    const { client } = fakeAuth(null);
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);

    await userEvent.type(await screen.findByLabelText('Email'), 'me@example.test');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    expect(client.sendEmailCode).toHaveBeenCalledWith('me@example.test');

    await userEvent.type(await screen.findByLabelText(/6-digit code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('wrong or has expired');

    await userEvent.clear(screen.getByLabelText(/6-digit code/i));
    await userEvent.type(screen.getByLabelText(/6-digit code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
  });

  it('shows a plain message when sending the code fails', async () => {
    const { client } = fakeAuth(null);
    client.sendEmailCode.mockRejectedValueOnce(new Error('You are offline.'));
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);
    await userEvent.type(await screen.findByLabelText('Email'), 'me@example.test');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You are offline.');
  });
});

describe('signed in', () => {
  it('opens the app and registers this device in the local database', async () => {
    const { client } = fakeAuth(ME);
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
    const db = openUserDb(ME.id);
    const deviceId = localStorage.getItem('airhead.deviceId') ?? '';
    await waitFor(async () => expect(await db.devices.get(deviceId)).toBeDefined());
    const row = await db.devices.get(deviceId);
    expect(row?.user_id).toBe(ME.id);
    expect(row?.platform).toBeTruthy();
    expect(await db.outbox.where('row_id').equals(deviceId).count()).toBe(1);
    db.close();
  });

  it('lists devices and signs out from Settings', async () => {
    const { client } = fakeAuth(ME);
    const db = openUserDb(ME.id);
    await save(db, 'devices', {
      ...baseRecord(ME.id),
      name: 'iPad',
      platform: 'ipados',
      push_subscription: null,
      receives_notifications: false,
      last_sync_at: null,
    });
    db.close();
    window.history.replaceState(null, '', '/settings');
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);

    expect(await screen.findByText('me@example.test')).toBeVisible();
    const list = await screen.findByRole('list', { name: 'Devices' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(within(list).getByText('iPad')).toBeVisible();
    expect(within(list).getByText('This device')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeVisible();
    expect(client.signOut).toHaveBeenCalledOnce();
  });
});
