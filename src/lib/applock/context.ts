import { createContext, useContext } from 'react';
import type { LockConfig } from './lock';

export interface AppLockState {
  config: LockConfig;
  locked: boolean;
  /** Registers Face ID / Touch ID and turns the lock on. */
  enable(label: string): Promise<void>;
  disable(): void;
  setTimeoutMinutes(minutes: number): void;
  unlock(): Promise<void>;
}

export const AppLockContext = createContext<AppLockState | null>(null);

export function useAppLock(): AppLockState {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used inside <AppLockProvider>');
  return ctx;
}
