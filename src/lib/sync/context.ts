import { createContext, useContext } from 'react';
import type { SyncStatus } from './types';

export interface SyncApi {
  /** null in local mode (no server). */
  status: SyncStatus | null;
  /** `force` (the Sync now button) restarts a run that is taking too long. */
  syncNow(options?: { force?: boolean }): Promise<void>;
}

export const SyncContext = createContext<SyncApi>({
  status: null,
  syncNow: async () => {},
});

export function useSync(): SyncApi {
  return useContext(SyncContext);
}
