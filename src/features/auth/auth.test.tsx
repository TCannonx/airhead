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
    googleEnabled: vi.fn(async () => false),
    signInWithGoogle: vi.fn(async () => {}),
    continueWithPassword: vi.fn(async (email: string, password: string) => {
      if (password !== 'correct horse') throw new Error('Wrong password for that email.');
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
  it('shows one email-and-password form when signed out, without a dead Google button', async () => {
    const { client } = fakeAuth(null);
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);
    expect(await screen.findByLabelText('Email')).toBeVisible();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).not.toBeInTheDocument();
  });

  it('shows Google only when the server has it switched on', async () => {
    const { client } = fakeAuth(null);
    client.googleEnabled.mockResolvedValue(true);
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    expect(client.signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('signs in (or signs up) with email and password, and explains a wrong password', async () => {
    const { client } = fakeAuth(null);
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);

    await userEvent.type(await screen.findByLabelText('Email'), ' me@example.test ');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password');

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(client.continueWithPassword).toHaveBeenLastCalledWith(
      'me@example.test',
      'correct horse',
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
  });

  it('switches to account creation so the password manager offers a strong password', async () => {
    const { client } = fakeAuth(null);
    client.continueWithPassword.mockRejectedValueOnce(
      new Error('This app is invite-only. Ask the owner to add your email.'),
    );
    render(<App services={{ auth: client, appLock: noLock, remote: null }} />);
    await userEvent.click(await screen.findByRole('button', { name: /new here/i }));
    const pw = screen.getByLabelText('Choose a password');
    expect(pw).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(screen.getByLabelText('Email'), 'stranger@example.test');
    await userEvent.type(pw, 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invite-only');
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
    expect(await screen.findByLabelText('Email')).toBeVisible();
    expect(client.signOut).toHaveBeenCalledOnce();
  });
});
