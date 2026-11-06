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
  if (/expired|invalid/i.test(message)) return new Error('That code is wrong or has expired.');
  return new Error(fallback);
}
