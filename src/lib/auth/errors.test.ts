import { describe, expect, it } from 'vitest';
import { friendlyAuthError, friendlyCodeError, linkError } from './errors';

describe('friendlyAuthError', () => {
  const online = true;

  it('turns the resend cool-down into a plain wait message', () => {
    const e = friendlyAuthError(
      { message: 'For security purposes, you can only request this after 42 seconds.' },
      'fallback',
      online,
    );
    expect(e.message).toBe('Wait 42 seconds, then try again.');
    const short = friendlyAuthError(
      { message: 'For security purposes, you can only request this after 0 seconds.' },
      'fallback',
      online,
    );
    expect(short.message).toBe('Wait a moment, then try again.');
  });

  it('handles rate limits, bad codes and offline', () => {
    expect(
      friendlyAuthError({ message: 'Email rate limit exceeded' }, 'f', online).message,
    ).toMatch(/too many attempts/i);
    expect(
      friendlyCodeError({ message: 'Token has expired or is invalid' }, 'f', online).message,
    ).toBe('That code is wrong or has expired.');
    expect(friendlyAuthError({ message: 'anything' }, 'f', false).message).toMatch(/offline/i);
  });

  it('falls back to the given plain message, never the raw server text', () => {
    expect(
      friendlyAuthError({ message: 'Database error: xyz' }, 'Try again.', online).message,
    ).toBe('Try again.');
  });

  it('never blames a code when sending the email failed', () => {
    expect(
      friendlyAuthError({ message: 'Email address "x@y" is invalid' }, 'Send failed.', online)
        .message,
    ).toBe('That email address does not look right.');
    expect(
      friendlyAuthError({ message: 'Token has expired or is invalid' }, 'Send failed.', online)
        .message,
    ).toBe('Send failed.');
    expect(
      friendlyCodeError({ message: 'Email rate limit exceeded' }, 'f', online).message,
    ).toMatch(/too many attempts/i);
  });

  it('explains a sign-in link that failed when it was opened', () => {
    expect(linkError('?error=access_denied&error_code=otp_expired', '')).toMatch(/link/i);
    expect(
      linkError('', '#error=access_denied&error_code=otp_expired&error_description=Email+link'),
    ).toMatch(/expired/i);
    expect(linkError('?code=abc', '')).toMatch(/same browser/i);
    expect(linkError('', '')).toBeNull();
  });
});
