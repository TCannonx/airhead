import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../lib/auth/context';

const button =
  'w-full rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500';
const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-900';

/**
 * One form for new and returning users: email + password, no emails sent.
 * The browser's password manager (iOS Keychain, Chrome) saves and fills it.
 */
export default function SignInScreen() {
  const { services } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [google, setGoogle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    services.auth.googleEnabled().then(
      (on) => {
        if (alive) setGoogle(on);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [services.auth]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(() => services.auth.continueWithPassword(email.trim(), password));
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/logo.svg" alt="" className="size-16 rounded-2xl" />
          <h1 className="text-2xl font-semibold tracking-tight">Airhead</h1>
          <p className="text-sm text-slate-500">Capture anything, sorted later.</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">
            <span>Email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              className={input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>{isNew ? 'Choose a password' : 'Password'}</span>
            <input
              type="password"
              name="password"
              required
              minLength={isNew ? 8 : undefined}
              // "new-password" makes iOS and Chrome offer a strong password and save it.
              autoComplete={isNew ? 'new-password' : 'current-password'}
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !email || !password}
            className={`${button} bg-indigo-600 text-white hover:bg-indigo-700`}
          >
            {isNew ? 'Create account' : 'Continue'}
          </button>
          <button
            type="button"
            className="w-full text-sm text-slate-500 underline"
            onClick={() => {
              setIsNew(!isNew);
              setError(null);
            }}
          >
            {isNew ? 'I already have an account' : 'New here? Create an account'}
          </button>
        </form>

        {google && (
          <>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              or
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>
            <button
              type="button"
              className={`${button} bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700`}
              disabled={busy}
              onClick={() => void run(() => services.auth.signInWithGoogle())}
            >
              Continue with Google
            </button>
          </>
        )}

        {error && (
          <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
