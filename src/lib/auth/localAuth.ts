import { webAuthnAppLock } from '../applock/webauthn';
import type { AuthClient, Services } from './types';

/** Fixed id for local-only mode (a valid GUID, like a real user id). */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Used when no Supabase project is configured (local development before the
 * projects exist, and the end-to-end tests). Always signed in as a local user;
 * nothing leaves the device.
 */
export function localServices(): Services {
  const auth: AuthClient = {
    mode: 'local',
    getUser: async () => ({ id: LOCAL_USER_ID, email: null }),
    onChange: () => () => {},
    signInWithGoogle: async () => {},
    sendEmailCode: async () => {},
    verifyEmailCode: async () => {},
    signOut: async () => {},
  };
  return {
    auth,
    appLock: webAuthnAppLock,
    remote: null,
  };
}
