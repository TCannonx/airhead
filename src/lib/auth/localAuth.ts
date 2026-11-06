import { webAuthnAppLock } from '../applock/webauthn';
import { currentDevice } from '../device';
import type { AuthClient, DeviceRow, Services } from './types';

/**
 * Used when no Supabase project is configured (local development before the
 * projects exist, and the end-to-end tests). Always signed in as a local user;
 * nothing leaves the device.
 */
export function localServices(): Services {
  const auth: AuthClient = {
    mode: 'local',
    getUser: async () => ({ id: 'local', email: null }),
    onChange: () => () => {},
    signInWithGoogle: async () => {},
    sendEmailCode: async () => {},
    verifyEmailCode: async () => {},
    signOut: async () => {},
  };
  const devices: DeviceRow[] = [];
  return {
    auth,
    appLock: webAuthnAppLock,
    devices: {
      async register(d) {
        if (!devices.some((r) => r.id === d.id)) devices.push({ ...d, last_sync_at: null });
      },
      async list() {
        if (devices.length === 0) devices.push({ ...currentDevice(), last_sync_at: null });
        return devices;
      },
    },
  };
}
