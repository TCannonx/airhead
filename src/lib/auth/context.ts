import { createContext, useContext } from 'react';
import type { AuthUser, Services } from './types';

export interface AuthState {
  status: 'loading' | 'signed_out' | 'signed_in';
  user: AuthUser | null;
  services: Services;
  deviceId: string;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
