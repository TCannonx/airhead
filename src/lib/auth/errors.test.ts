import { describe, expect, it } from 'vitest';
import { friendlyAuthError } from './errors';

describe('friendlyAuthError', () => {
  const online = true;

  it('turns the resend cool-down into a plain wait message', () => {
    const e = friendlyAuthError(
      { message: 'For security purposes, you can only request this after 42 seconds.' },
      'fallback',
      online,
    );
    expect(e.message).toBe('Wait 42 seconds, then try again.');
  });

  it('handles rate limits, bad codes and offline', () => {
    expect(
      friendlyAuthError({ message: 'Email rate limit exceeded' }, 'f', online).message,
    ).toMatch(/too many attempts/i);
    expect(
      friendlyAuthError({ message: 'Token has expired or is invalid' }, 'f', online).message,
    ).toBe('That code is wrong or has expired.');
    expect(friendlyAuthError({ message: 'anything' }, 'f', false).message).toMatch(/offline/i);
  });

  it('falls back to the given plain message, never the raw server text', () => {
    expect(
      friendlyAuthError({ message: 'Database error: xyz' }, 'Try again.', online).message,
    ).toBe('Try again.');
  });
});
