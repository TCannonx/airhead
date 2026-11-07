/**
 * Capture tokens for iOS Shortcuts (Task 7.1). A token is 32 random bytes,
 * base64url; only its sha-256 hash (hex) is stored on the server, so the token
 * is shown once and can't be recovered, only revoked.
 */
export const TOKEN_PREFIX = 'ah_';

export function newTokenValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return TOKEN_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CaptureTokenRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
