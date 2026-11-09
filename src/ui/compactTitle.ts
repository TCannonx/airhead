import { createContext, useContext } from 'react';

/**
 * Lets a PageHeader tell the app shell its title once the large title has
 * scrolled away, so the phone's top bar can show it small (iOS behaviour).
 * Without a shell (tests, the design kit) it does nothing.
 */
export const CompactTitleContext = createContext<(title: string | null) => void>(() => {});

export const useSetCompactTitle = () => useContext(CompactTitleContext);
