import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { currentDevice } from '../device';
import { AuthContext, type AuthState } from './context';
import type { AuthUser, Services } from './types';

export function AuthProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const device = useMemo(() => currentDevice(), []);
  const registeredFor = useRef<string | null>(null);

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

  // Register this device once per signed-in user. Failure (e.g. offline) is
  // retried on the next app start.
  useEffect(() => {
    if (!user || registeredFor.current === user.id) return;
    registeredFor.current = user.id;
    services.devices.register(device).catch(() => {
      registeredFor.current = null;
    });
  }, [user, device, services.devices]);

  const value = useMemo<AuthState>(
    () => ({ status, user, services, deviceId: device.id }),
    [status, user, services, device.id],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}
