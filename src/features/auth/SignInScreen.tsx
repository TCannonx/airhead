import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../lib/auth/context';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';

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
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-fg">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/logo.svg" alt="" className="size-16 rounded-2xl" />
          <h1 className="text-title">Airhead</h1>
          <p className="text-footnote text-fg-muted">Capture anything, sorted later.</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <TextField
            label="Email"
            type="email"
            name="email"
            required
            autoComplete="username"
            autoCapitalize="none"
            className="[&_input]:min-h-12"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label={isNew ? 'Choose a password' : 'Password'}
            type="password"
            name="password"
            required
            minLength={isNew ? 8 : undefined}
            // "new-password" makes iOS and Chrome offer a strong password and save it.
            autoComplete={isNew ? 'new-password' : 'current-password'}
            hint={isNew ? 'At least 8 characters.' : undefined}
            className="[&_input]:min-h-12"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="mt-2"
            loading={busy}
            disabled={!email || !password}
          >
            {isNew ? 'Create account' : 'Continue'}
          </Button>
          <Button
            variant="plain"
            size="sm"
            className="w-full"
            onClick={() => {
              setIsNew(!isNew);
              setError(null);
            }}
          >
            {isNew ? 'I already have an account' : 'New here? Create an account'}
          </Button>
        </form>

        {google && (
          <>
            <div className="flex items-center gap-3 text-caption text-fg-subtle">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              size="lg"
              disabled={busy}
              onClick={() => void run(() => services.auth.signInWithGoogle())}
            >
              Continue with Google
            </Button>
          </>
        )}

        {error && (
          <p role="alert" className="text-center text-footnote text-danger">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
