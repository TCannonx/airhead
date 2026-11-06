import type { Remote } from '../sync/types';

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

/** Face ID / Touch ID for the app lock (WebAuthn in the app, fakes in tests). */
export interface AppLockAuthenticator {
  available(): Promise<boolean>;
  /** Registers a platform credential and returns its id (base64url). */
  register(label: string): Promise<string>;
  /** Resolves when the user passed Face ID / Touch ID; throws a plain Error otherwise. */
  verify(credentialId: string): Promise<void>;
}

export interface Services {
  auth: AuthClient;
  appLock: AppLockAuthenticator;
  /** The sync server; null in local mode (nothing leaves the device). */
  remote: Remote | null;
}
