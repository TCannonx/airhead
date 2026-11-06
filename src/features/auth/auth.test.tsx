import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import type { AuthClient, AuthUser, DeviceRow, DeviceStore } from '../../lib/auth/types';

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
      set({ id: 'user-1', email });
    }),
    signOut: vi.fn(async () => set(null)),
  } satisfies AuthClient;
  return { client, set };
}

function fakeDevices(rows: DeviceRow[] = []) {
  const store = {
    register: vi.fn(async (d: Omit<DeviceRow, 'last_sync_at'>) => {
      if (!rows.some((r) => r.id === d.id)) rows.push({ ...d, last_sync_at: null });
    }),
    list: vi.fn(async () => rows),
  } satisfies DeviceStore;
  return store;
}

const ME: AuthUser = { id: 'user-1', email: 'me@example.test' };

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  window.history.replaceState(null, '', '/');
});

describe('sign-in', () => {
  it('shows the sign-in screen when signed out', async () => {
    const { client } = fakeAuth(null);
    render(<App services={{ auth: client, devices: fakeDevices() }} />);
    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).not.toBeInTheDocument();
  });

  it('starts Google sign-in from the button', async () => {
    const { client } = fakeAuth(null);
    render(<App services={{ auth: client, devices: fakeDevices() }} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    expect(client.signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('signs in with an emailed code', async () => {
    const { client } = fakeAuth(null);
    const devices = fakeDevices();
    render(<App services={{ auth: client, devices }} />);

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
    render(<App services={{ auth: client, devices: fakeDevices() }} />);
    await userEvent.type(await screen.findByLabelText('Email'), 'me@example.test');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You are offline.');
  });
});

describe('signed in', () => {
  it('opens the app and registers this device once', async () => {
    const { client } = fakeAuth(ME);
    const devices = fakeDevices();
    render(<App services={{ auth: client, devices }} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
    await waitFor(() => expect(devices.register).toHaveBeenCalledOnce());
    const registered = devices.register.mock.calls[0]?.[0];
    expect(registered?.id).toBe(localStorage.getItem('airhead.deviceId'));
    expect(registered?.platform).toBeTruthy();
    expect(registered?.name).toBeTruthy();
  });

  it('lists devices and signs out from Settings', async () => {
    const { client } = fakeAuth(ME);
    const devices = fakeDevices([
      { id: 'other', name: 'iPad', platform: 'ipados', last_sync_at: null },
    ]);
    window.history.replaceState(null, '', '/settings');
    render(<App services={{ auth: client, devices }} />);

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
