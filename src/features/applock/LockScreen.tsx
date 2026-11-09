import { useState } from 'react';
import { useAppLock } from '../../lib/applock/context';
import { Button } from '../../ui/Button';

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
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-fg">
      <div className="w-full max-w-sm space-y-6 text-center">
        <img src="/logo.svg" alt="" className="mx-auto size-16 rounded-2xl" />
        <h1 className="text-title">Airhead is locked</h1>
        <Button variant="primary" size="lg" loading={busy} onClick={() => void tryUnlock()}>
          Unlock with Face ID / Touch ID
        </Button>
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
        <p className="text-footnote text-fg-muted">
          Can&apos;t unlock?{' '}
          <Button variant="plain" size="sm" className="-mx-1 px-1" onClick={() => void onSignOut()}>
            Sign out
          </Button>{' '}
          and sign back in. Your data stays safe on the server.
        </p>
      </div>
    </main>
  );
}
