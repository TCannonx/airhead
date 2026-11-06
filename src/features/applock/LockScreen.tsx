import { useState } from 'react';
import { useAppLock } from '../../lib/applock/context';

export default function LockScreen({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { unlock } = useAppLock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tryUnlock() {
    setBusy(true);
    setError(null);
    try {
      await unlock();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlock failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-sm space-y-6 text-center">
        <img src="/logo.svg" alt="" className="mx-auto size-16 rounded-2xl" />
        <h1 className="text-2xl font-semibold tracking-tight">Airhead is locked</h1>
        <button
          type="button"
          disabled={busy}
          onClick={() => void tryUnlock()}
          className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Unlock with Face ID / Touch ID
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <p className="text-sm text-slate-500">
          Can&apos;t unlock?{' '}
          <button type="button" className="underline" onClick={() => void onSignOut()}>
            Sign out
          </button>{' '}
          and sign back in. Your data stays safe on the server.
        </p>
      </div>
    </main>
  );
}
