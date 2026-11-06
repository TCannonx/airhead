/**
 * App lock: a privacy screen, not encryption. Data on the device is not
 * encrypted by it; it only stops someone picking up an unlocked phone from
 * browsing Airhead. Settings are per device (Face ID belongs to one device).
 */
export interface LockConfig {
  enabled: boolean;
  /** WebAuthn credential id (base64url) registered on this device. */
  credentialId: string | null;
  /** 0 = lock every time the app is left. */
  timeoutMinutes: number;
}

export const TIMEOUT_CHOICES = [0, 1, 5, 15, 60] as const;
export const DEFAULT_LOCK_CONFIG: LockConfig = {
  enabled: false,
  credentialId: null,
  timeoutMinutes: 5,
};

const KEY = 'airhead.appLock';

export function isLockActive(config: LockConfig): boolean {
  return config.enabled && !!config.credentialId;
}

/**
 * `resume` = the app became visible again; `tick` = periodic check while in use.
 * `lastActiveMs` is the last user interaction (or the moment the app was hidden).
 */
export function shouldLock(
  config: LockConfig,
  lastActiveMs: number,
  nowMs: number,
  event: 'resume' | 'tick',
): boolean {
  if (!isLockActive(config)) return false;
  if (config.timeoutMinutes === 0) return event === 'resume';
  return nowMs - lastActiveMs >= config.timeoutMinutes * 60_000;
}

export function loadLockConfig(storage: Storage): LockConfig {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return DEFAULT_LOCK_CONFIG;
    const v = JSON.parse(raw) as Partial<LockConfig>;
    const valid =
      typeof v.enabled === 'boolean' &&
      (v.credentialId === null || typeof v.credentialId === 'string') &&
      typeof v.timeoutMinutes === 'number' &&
      (TIMEOUT_CHOICES as readonly number[]).includes(v.timeoutMinutes);
    return valid ? (v as LockConfig) : DEFAULT_LOCK_CONFIG;
  } catch {
    return DEFAULT_LOCK_CONFIG;
  }
}

export function saveLockConfig(storage: Storage, config: LockConfig): void {
  storage.setItem(KEY, JSON.stringify(config));
}

export function toBase64Url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): ArrayBuffer {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
