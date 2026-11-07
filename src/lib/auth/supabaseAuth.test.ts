import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { supabaseAuth } from './supabaseAuth';

type Err = { code?: string; message: string } | null;

function fakeSupabase(signIn: Err, signUp: Err, session: object | null = { user: {} }) {
  const auth = {
    signInWithPassword: vi.fn(async () => ({ error: signIn })),
    signUp: vi.fn(async () => ({ error: signUp, data: { session: signUp ? null : session } })),
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
}

describe('continueWithPassword', () => {
  it('signs a returning user straight in', async () => {
    const { client, auth } = fakeSupabase(null, null);
    await supabaseAuth(client).continueWithPassword('me@x.test', 'pw');
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('creates the account when the address is new', async () => {
    const { client, auth } = fakeSupabase(
      { code: 'invalid_credentials', message: 'Invalid' },
      null,
    );
    await supabaseAuth(client).continueWithPassword('new@x.test', 'a long password');
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'new@x.test', password: 'a long password' });
  });

  it('says "wrong password" when the address already has an account', async () => {
    const { client } = fakeSupabase(
      { code: 'invalid_credentials', message: 'Invalid' },
      { code: 'user_already_exists', message: 'User already registered' },
    );
    await expect(supabaseAuth(client).continueWithPassword('me@x.test', 'typo')).rejects.toThrow(
      'Wrong password for that email.',
    );
  });

  it('turns the invite-only refusal into a plain message', async () => {
    const { client } = fakeSupabase(
      { code: 'invalid_credentials', message: 'Invalid' },
      { code: 'unexpected_failure', message: 'invite_only: This app is invite-only.' },
    );
    await expect(
      supabaseAuth(client).continueWithPassword('stranger@x.test', 'a long password'),
    ).rejects.toThrow(/invite-only. Ask the owner/);
  });

  it('says so when the server still requires email confirmation', async () => {
    const { client } = fakeSupabase(
      { code: 'invalid_credentials', message: 'Invalid' },
      null,
      null,
    );
    await expect(
      supabaseAuth(client).continueWithPassword('new@x.test', 'a long password'),
    ).rejects.toThrow(/email confirmed/);
  });
});

describe('googleEnabled', () => {
  it('reads the server settings once, and is false without them or on errors', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ external: { google: true } }), { status: 200 }),
    );
    const auth = supabaseAuth({} as SupabaseClient, {
      url: 'https://p.supabase.co/',
      key: 'anon',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(await auth.googleEnabled()).toBe(true);
    expect(await auth.googleEnabled()).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledWith('https://p.supabase.co/auth/v1/settings', {
      headers: { apikey: 'anon' },
    });
    expect(await supabaseAuth({} as SupabaseClient).googleEnabled()).toBe(false);
    const failing = supabaseAuth({} as SupabaseClient, {
      url: 'u',
      key: 'k',
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(await failing.googleEnabled()).toBe(false);
  });
});
