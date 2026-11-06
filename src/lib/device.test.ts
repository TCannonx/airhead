import { beforeEach, describe, expect, it } from 'vitest';
import { defaultDeviceName, detectPlatform, getDeviceId } from './device';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  // iPadOS Safari reports itself as a Mac; only touch support gives it away.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  android:
    'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
  it.each([
    [UA.iphone, 5, 'ios'],
    [UA.ipad, 5, 'ipados'],
    [UA.mac, 0, 'macos'],
    [UA.windows, 0, 'windows'],
    [UA.android, 5, 'android'],
    [UA.linux, 0, 'linux'],
    ['something else', 0, 'other'],
  ] as const)('%#: -> %s', (ua, touchPoints, expected) => {
    expect(detectPlatform(ua, touchPoints)).toBe(expected);
  });
});

describe('defaultDeviceName', () => {
  it.each([
    ['ios', UA.iphone, 'iPhone'],
    ['ipados', UA.ipad, 'iPad'],
    ['windows', UA.windows, 'Chrome on Windows'],
    ['macos', UA.mac, 'Chrome on Mac'],
    ['android', UA.android, 'Android'],
  ] as const)('%s -> %s', (platform, ua, expected) => {
    expect(defaultDeviceName(platform, ua)).toBe(expected);
  });
});

describe('getDeviceId', () => {
  beforeEach(() => localStorage.clear());

  it('creates a UUID once and then keeps returning it', () => {
    const first = getDeviceId(localStorage);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDeviceId(localStorage)).toBe(first);
  });
});
