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

/** Like friendlyAuthError, for checking a typed code: "invalid/expired" means the code. */
export function friendlyCodeError(
  error: AuthErrorLike,
  fallback: string,
  online: boolean = isOnline(),
): Error {
  const plain = known(error, online);
  if (plain) return new Error(plain);
  if (/expired|invalid/i.test(error?.message ?? ''))
    return new Error('That code is wrong or has expired.');
  return new Error(withCode(fallback, error));
}

/**
 * When a sign-in link from the email fails, Supabase sends the browser back with
 * `error=…` in the query or hash. Returns a plain message, or null when there's none.
 */
export function linkError(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const fromHash = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('error_code') ?? fromHash.get('error_code');
  const error = params.get('error') ?? fromHash.get('error');
  if (!code && !error) {
    // The sign-in screen only shows once the link's ?code=… exchange is over, so a
    // code still in the address means it failed: usually the link was opened in a
    // different browser or app from the one that asked for it.
    if (params.get('code'))
      return 'That link has to be opened in the same browser you asked for it in. Type the code from the email instead, or ask for a new one here.';
    return null;
  }
  if (code === 'otp_expired')
    return 'That sign-in link has expired or was already used. Type the code from the email instead, or ask for a new one.';
  return 'That sign-in link did not work. Type the code from the email instead, or ask for a new one.';
}
