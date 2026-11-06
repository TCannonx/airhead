import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { currentDevice } from '../device';
import { AuthContext, type AuthState } from './context';
import type { AuthUser, Services } from './types';

export function AuthProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const device = useMemo(() => currentDevice(), []);

  useEffect(() => {
    let alive = true;
    const apply = (u: AuthUser | null) => {
      if (!alive) return;
      setUser(u);
      setStatus(u ? 'signed_in' : 'signed_out');
    };
    const unsubscribe = services.auth.onChange(apply);
    services.auth.getUser().then(apply, () => apply(null));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [services.auth]);

  const value = useMemo<AuthState>(
    () => ({ status, user, services, deviceId: device.id }),
    [status, user, services, device.id],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}
