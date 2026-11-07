/** Maps Supabase Auth errors to plain-language messages (never raw server text). */
export function friendlyAuthError(
  error: { message?: string } | null,
  fallback: string,
  online: boolean = typeof navigator === 'undefined' || navigator.onLine,
): Error {
  if (!online) return new Error('You are offline. Try again when you have a connection.');
  const message = error?.message ?? '';
  const wait = message.match(/after (\d+) seconds?/i);
  if (wait) {
    const seconds = Number(wait[1]);
    return new Error(
      seconds <= 1 ? 'Wait a moment, then try again.' : `Wait ${seconds} seconds, then try again.`,
    );
  }
  if (/rate limit/i.test(message))
    return new Error('Too many attempts. Wait a minute and try again.');
  if (/email address .* is invalid|invalid email/i.test(message))
    return new Error('That email address does not look right.');
  return new Error(fallback);
}

/** Like friendlyAuthError, for checking a typed code: "invalid/expired" means the code. */
export function friendlyCodeError(
  error: { message?: string } | null,
  fallback: string,
  online: boolean = typeof navigator === 'undefined' || navigator.onLine,
): Error {
  const general = friendlyAuthError(error, fallback, online);
  if (general.message !== fallback) return general;
  if (/expired|invalid/i.test(error?.message ?? ''))
    return new Error('That code is wrong or has expired.');
  return general;
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
