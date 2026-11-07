import { createContext, useContext } from 'react';
import type { SortOutcome } from '../auth/types';

export interface SortApi {
  /** False in local mode (no server to sort on). */
  available: boolean;
  running: boolean;
  last: SortOutcome | null;
  sortNow(): Promise<void>;
}

export const SortContext = createContext<SortApi>({
  available: false,
  running: false,
  last: null,
  sortNow: async () => {},
});

export const useSort = () => useContext(SortContext);
