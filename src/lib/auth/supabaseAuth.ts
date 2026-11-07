import type { SupabaseClient, User } from '@supabase/supabase-js';
import { friendlyAuthError as plain, friendlyCodeError } from './errors';
import type { AuthClient, AuthUser } from './types';

const toUser = (u: User | null | undefined): AuthUser | null =>
  u ? { id: u.id, email: u.email ?? null } : null;

export function supabaseAuth(supabase: SupabaseClient): AuthClient {
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
    async signInWithGoogle() {
      // Login only: Supabase asks Google for the basic openid/email/profile scopes.
      // No calendar, Drive or Gmail scopes are ever requested.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw plain(error, 'Google sign-in could not start. Try again.');
    },
    async sendEmailCode(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
      });
      if (error) throw plain(error, 'The email could not be sent. Try again.');
    },
    async verifyEmailCode(email, code) {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw friendlyCodeError(error, 'That code did not work. Try again.');
    },
    async signOut() {
      // 'local' signs out this device only; other devices stay signed in.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw plain(error, 'Sign-out failed. Try again.');
    },
  };
}
