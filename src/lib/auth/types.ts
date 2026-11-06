import type { Platform } from '../device';

export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * The slice of authentication the app needs. Implemented over Supabase Auth
 * (`supabaseAuth.ts`), by a local-only stand-in when no server is configured,
 * and by fakes in tests. Methods throw `Error`s with plain-language messages.
 */
export interface AuthClient {
  /** 'server' = Supabase; 'local' = no server configured, nothing leaves the device. */
  mode: 'server' | 'local';
  getUser(): Promise<AuthUser | null>;
  onChange(cb: (user: AuthUser | null) => void): () => void;
  signInWithGoogle(): Promise<void>;
  /** Emails a 6-digit code (the same email also carries a sign-in link). */
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface DeviceRow {
  id: string;
  name: string;
  platform: Platform;
  last_sync_at: string | null;
}

export interface DeviceStore {
  /** Adds this device if it isn't registered yet (never renames an existing one). */
  register(device: Omit<DeviceRow, 'last_sync_at'>): Promise<void>;
  list(): Promise<DeviceRow[]>;
}

export interface Services {
  auth: AuthClient;
  devices: DeviceStore;
}
