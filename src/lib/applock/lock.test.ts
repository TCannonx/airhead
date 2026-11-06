import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCK_CONFIG,
  fromBase64Url,
  isLockActive,
  loadLockConfig,
  saveLockConfig,
  shouldLock,
  toBase64Url,
  type LockConfig,
} from './lock';

const MIN = 60_000;
const on = (timeoutMinutes: number): LockConfig => ({
  enabled: true,
  credentialId: 'cred',
  timeoutMinutes,
});

describe('isLockActive', () => {
  it('needs both the switch and a registered credential', () => {
    expect(isLockActive(DEFAULT_LOCK_CONFIG)).toBe(false);
    expect(isLockActive({ ...on(5), credentialId: null })).toBe(false);
    expect(isLockActive({ ...on(5), enabled: false })).toBe(false);
    expect(isLockActive(on(5))).toBe(true);
  });
});

describe('shouldLock', () => {
  it('never locks when the lock is off', () => {
    expect(shouldLock(DEFAULT_LOCK_CONFIG, 0, 10 * 60 * MIN, 'resume')).toBe(false);
    expect(shouldLock(DEFAULT_LOCK_CONFIG, 0, 10 * 60 * MIN, 'tick')).toBe(false);
  });

  it('locks once the inactivity time-out has passed', () => {
    expect(shouldLock(on(5), 0, 5 * MIN - 1, 'tick')).toBe(false);
    expect(shouldLock(on(5), 0, 5 * MIN, 'tick')).toBe(true);
    expect(shouldLock(on(5), 0, 4 * MIN, 'resume')).toBe(false);
    expect(shouldLock(on(5), 0, 6 * MIN, 'resume')).toBe(true);
  });

  it('"immediately" locks every time the app comes back, but not while in use', () => {
    expect(shouldLock(on(0), 0, 1, 'resume')).toBe(true);
    expect(shouldLock(on(0), 0, 60 * MIN, 'tick')).toBe(false);
  });
});

describe('lock config storage', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to off with a 5-minute time-out', () => {
    expect(loadLockConfig(localStorage)).toEqual({
      enabled: false,
      credentialId: null,
      timeoutMinutes: 5,
    });
  });

  it('round-trips', () => {
    saveLockConfig(localStorage, on(15));
    expect(loadLockConfig(localStorage)).toEqual(on(15));
  });

  it('falls back to defaults when the stored value is corrupt', () => {
    localStorage.setItem('airhead.appLock', '{nope');
    expect(loadLockConfig(localStorage)).toEqual(DEFAULT_LOCK_CONFIG);
    localStorage.setItem('airhead.appLock', JSON.stringify({ enabled: 'yes', timeoutMinutes: -3 }));
    expect(loadLockConfig(localStorage)).toEqual(DEFAULT_LOCK_CONFIG);
  });
});

describe('base64url', () => {
  it('round-trips arbitrary bytes without padding or + /', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]);
    const text = toBase64Url(bytes.buffer);
    expect(text).not.toMatch(/[+/=]/);
    expect(new Uint8Array(fromBase64Url(text))).toEqual(bytes);
  });
});
