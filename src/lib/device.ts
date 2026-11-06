export type Platform = 'ios' | 'ipados' | 'android' | 'macos' | 'windows' | 'linux' | 'other';

export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPod/.test(userAgent)) return 'ios';
  if (/iPad/.test(userAgent)) return 'ipados';
  if (/Android/.test(userAgent)) return 'android';
  // iPadOS Safari asks for desktop sites and reports "Macintosh"; touch gives it away.
  if (/Macintosh/.test(userAgent)) return maxTouchPoints > 1 ? 'ipados' : 'macos';
  if (/Windows/.test(userAgent)) return 'windows';
  if (/Linux|X11|CrOS/.test(userAgent)) return 'linux';
  return 'other';
}

function browserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Chrome\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'Browser';
}

export function defaultDeviceName(platform: Platform, userAgent: string): string {
  switch (platform) {
    case 'ios':
      return 'iPhone';
    case 'ipados':
      return 'iPad';
    case 'android':
      return 'Android';
    case 'macos':
      return `${browserName(userAgent)} on Mac`;
    case 'windows':
      return `${browserName(userAgent)} on Windows`;
    case 'linux':
      return `${browserName(userAgent)} on Linux`;
    default:
      return browserName(userAgent);
  }
}

const DEVICE_ID_KEY = 'airhead.deviceId';

/** A random id for this install, created once and kept in local storage. */
export function getDeviceId(storage: Storage): string {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  storage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function currentDevice() {
  const ua = navigator.userAgent;
  const platform = detectPlatform(ua, navigator.maxTouchPoints ?? 0);
  return { id: getDeviceId(localStorage), platform, name: defaultDeviceName(platform, ua) };
}
