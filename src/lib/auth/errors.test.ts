import { describe, expect, it } from 'vitest';
import { friendlyAuthError, passwordError } from './errors';

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

  it('handles rate limits and offline', () => {
    expect(
      friendlyAuthError({ message: 'Email rate limit exceeded' }, 'f', online).message,
    ).toMatch(/too many attempts/i);
    expect(friendlyAuthError({ message: 'anything' }, 'f', false).message).toMatch(/offline/i);
  });

  it('falls back to the given plain message, never the raw server text', () => {
    expect(
      friendlyAuthError({ message: 'Database error: xyz' }, 'Try again.', online).message,
    ).toBe('Try again.');
  });

  it('names the server error code on unknown failures, and knows the email ones', () => {
    expect(
      friendlyAuthError(
        { message: 'Error sending magic link email', code: 'unexpected_failure' },
        'The email could not be sent. Try again.',
        online,
      ).message,
    ).toBe('The email could not be sent. Try again (unexpected_failure).');
    expect(
      friendlyAuthError({ message: 'x', code: 'email_address_not_authorized' }, 'f', online)
        .message,
    ).toMatch(/email sender/i);
    expect(
      friendlyAuthError({ message: 'x', code: 'over_email_send_rate_limit' }, 'f', online).message,
    ).toMatch(/too many/i);
    expect(
      friendlyAuthError({ message: 'x', code: '<b>bad</b>' }, 'Try again.', online).message,
    ).toBe('Try again.');
  });

  it('explains password sign-in and sign-up failures', () => {
    const msg = (e: { message: string; code?: string }) =>
      passwordError(e, 'Try again.', online).message;
    expect(msg({ message: 'invite_only: This app is invite-only.', code: 'unexpected' })).toMatch(
      /invite-only/,
    );
    expect(
      msg({ message: 'Password should be at least 6 characters.', code: 'weak_password' }),
    ).toMatch(/longer password/);
    expect(msg({ message: 'Email not confirmed', code: 'email_not_confirmed' })).toMatch(
      /confirmed/,
    );
    expect(msg({ message: 'boom', code: 'unexpected_failure' })).toBe(
      'Try again (unexpected_failure).',
    );
  });
});
