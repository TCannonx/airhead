import type { ReactNode } from 'react';
import { useAuth } from '../../lib/auth/context';
import { DataProvider } from '../../lib/db/DataProvider';
import { SyncProvider } from '../../lib/sync/SyncProvider';
import { AppLockProvider } from '../applock/AppLockProvider';
import SignInScreen from './SignInScreen';

export default function AuthGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white dark:bg-slate-950">
        <img src="/logo.svg" alt="Airhead" className="size-16 animate-pulse rounded-2xl" />
      </div>
    );
  }
  if (status === 'signed_out' || !user) return <SignInScreen />;
  return (
    <DataProvider userId={user.id}>
      <SyncProvider>
        <AppLockProvider>{children}</AppLockProvider>
      </SyncProvider>
    </DataProvider>
  );
}
