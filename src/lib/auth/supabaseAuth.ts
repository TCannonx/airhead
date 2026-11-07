import type { SupabaseClient, User } from '@supabase/supabase-js';
import { friendlyAuthError as plain, passwordError } from './errors';
import type { AuthClient, AuthUser } from './types';

const toUser = (u: User | null | undefined): AuthUser | null =>
  u ? { id: u.id, email: u.email ?? null } : null;

/** Where to ask which sign-in methods the server has switched on. */
export interface AuthSettingsSource {
  url: string;
  key: string;
  fetch?: typeof fetch;
}

export function supabaseAuth(supabase: SupabaseClient, settings?: AuthSettingsSource): AuthClient {
  let google: Promise<boolean> | null = null;
  return {
    mode: 'server',
    async getUser() {
      // getSession reads the stored session, so it works offline.
      const { data } = await supabase.auth.getSession();
      return toUser(data.session?.user);
    },
    onChange(cb) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) =>
        cb(toUser(session?.user)),
      );
      return () => data.subscription.unsubscribe();
    },
    googleEnabled() {
      if (!settings) return Promise.resolve(false);
      google ??= (settings.fetch ?? fetch)(`${settings.url.replace(/\/+$/, '')}/auth/v1/settings`, {
        headers: { apikey: settings.key },
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ external?: { google?: boolean } }>) : null))
        .then((s) => s?.external?.google === true)
        .catch(() => false);
      return google;
    },
    async signInWithGoogle() {
      // Login only: Supabase asks Google for the basic openid/email/profile scopes.
      // No calendar, Drive or Gmail scopes are ever requested.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw plain(error, 'Google sign-in could not start. Try again.');
    },
    async continueWithPassword(email, password) {
      const signIn = await supabase.auth.signInWithPassword({ email, password });
      if (!signIn.error) return;
      // A wrong password and an unknown address look the same to the server;
      // try creating the account and let its answer tell the two apart.
      if (signIn.error.code !== 'invalid_credentials')
        throw passwordError(signIn.error, 'Sign-in failed. Try again.');
      const signUp = await supabase.auth.signUp({ email, password });
      if (signUp.error) {
        if (
          signUp.error.code === 'user_already_exists' ||
          /already registered/i.test(signUp.error.message)
        )
          throw new Error('Wrong password for that email.');
        throw passwordError(signUp.error, 'The account could not be created. Try again.');
      }
      if (!signUp.data.session)
        throw new Error(
          'Your account was made, but the server still wants the email confirmed first. Check your inbox, or switch off email confirmation in Supabase.',
        );
    },
    async signOut() {
      // 'local' signs out this device only; other devices stay signed in.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw plain(error, 'Sign-out failed. Try again.');
    },
  };
}
