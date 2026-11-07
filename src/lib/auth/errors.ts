type AuthErrorLike = { message?: string; code?: string } | null;

/** The plain message for a known error, or null. */
function known(error: AuthErrorLike, online: boolean): string | null {
  if (!online) return 'You are offline. Try again when you have a connection.';
  const message = error?.message ?? '';
  const wait = message.match(/after (\d+) seconds?/i);
  if (wait) {
    const seconds = Number(wait[1]);
    return seconds <= 1
      ? 'Wait a moment, then try again.'
      : `Wait ${seconds} seconds, then try again.`;
  }
  if (/rate limit/i.test(message) || error?.code === 'over_email_send_rate_limit')
    return 'Too many attempts. Wait a minute and try again.';
  if (error?.code === 'email_address_not_authorized')
    return "This address can't get sign-in emails yet: the server's email sender isn't set up for it.";
  if (
    /email address .* is invalid|invalid email/i.test(message) ||
    error?.code === 'email_address_invalid'
  )
    return 'That email address does not look right.';
  return null;
}

/** Adds the server's short error code (never its raw text) so a failure can be traced. */
const withCode = (fallback: string, error: AuthErrorLike) =>
  error?.code && /^[a-z_]{1,60}$/.test(error.code)
    ? `${fallback.replace(/\.?$/, '')} (${error.code}).`
    : fallback;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine;

/** Maps Supabase Auth errors to plain-language messages (never raw server text). */
export function friendlyAuthError(
  error: AuthErrorLike,
  fallback: string,
  online: boolean = isOnline(),
): Error {
  return new Error(known(error, online) ?? withCode(fallback, error));
}

/** Errors from email-and-password sign-in and sign-up. */
export function passwordError(
  error: AuthErrorLike,
  fallback: string,
  online: boolean = isOnline(),
): Error {
  const plain = known(error, online);
  if (plain) return new Error(plain);
  const message = error?.message ?? '';
  // The invite-only sign-up hook (migration 0029) starts its message with this marker.
  if (/invite_only/i.test(message))
    return new Error('This app is invite-only. Ask the owner to add your email.');
  if (error?.code === 'weak_password' || /password should be/i.test(message))
    return new Error('Choose a longer password (at least 8 characters).');
  if (error?.code === 'email_not_confirmed')
    return new Error('This account still needs its email confirmed. Check your inbox.');
  if (error?.code === 'signup_disabled')
    return new Error('New accounts are switched off on this server.');
  return new Error(withCode(fallback, error));
}
