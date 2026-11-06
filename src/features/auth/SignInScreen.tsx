import { useState, type FormEvent } from 'react';
import { useAuth } from '../../lib/auth/context';

const button =
  'w-full rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500';
const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-900';

export default function SignInScreen() {
  const { services } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function sendCode(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await services.auth.sendEmailCode(email.trim());
      setStep('code');
    });
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    void run(() => services.auth.verifyEmailCode(email.trim(), code.trim()));
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/logo.svg" alt="" className="size-16 rounded-2xl" />
          <h1 className="text-2xl font-semibold tracking-tight">Airhead</h1>
          <p className="text-sm text-slate-500">Capture anything, sorted later.</p>
        </div>

        <button
          type="button"
          className={`${button} bg-indigo-600 text-white hover:bg-indigo-700`}
          disabled={busy}
          onClick={() => void run(() => services.auth.signInWithGoogle())}
        >
          Continue with Google
        </button>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          or
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>

        {step === 'email' ? (
          <form onSubmit={sendCode} className="space-y-3">
            <label className="block space-y-1 text-sm font-medium">
              <span>Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                className={input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={busy || !email}
              className={`${button} bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700`}
            >
              Email me a code
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <p className="text-sm text-slate-500">
              We sent a code to <strong>{email}</strong>. Type it here, or tap the link in the email
              if you&apos;re in a browser.
            </p>
            <label className="block space-y-1 text-sm font-medium">
              <span>6-digit code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={10}
                required
                className={`${input} tracking-widest`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={busy || !code}
              className={`${button} bg-indigo-600 text-white hover:bg-indigo-700`}
            >
              Sign in
            </button>
            <button
              type="button"
              className="w-full text-sm text-slate-500 underline"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
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
