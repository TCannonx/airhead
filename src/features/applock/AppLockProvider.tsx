import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth/context';
import { AppLockContext, type AppLockState } from '../../lib/applock/context';
import {
  DEFAULT_LOCK_CONFIG,
  isLockActive,
  loadLockConfig,
  saveLockConfig,
  shouldLock,
  type LockConfig,
} from '../../lib/applock/lock';
import LockScreen from './LockScreen';

const TICK_MS = 15_000;

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { services } = useAuth();
  const [config, setConfig] = useState<LockConfig>(() => loadLockConfig(localStorage));
  const [locked, setLocked] = useState(() => isLockActive(loadLockConfig(localStorage)));
  const lastActive = useRef(0);
  const configRef = useRef(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const update = useCallback((patch: Partial<LockConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveLockConfig(localStorage, next);
      return next;
    });
  }, []);

  // Track activity, lock on resume after the time-out and on idle ticks.
  useEffect(() => {
    lastActive.current = Date.now();
    const touch = () => {
      lastActive.current = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        lastActive.current = Date.now();
      } else if (shouldLock(configRef.current, lastActive.current, Date.now(), 'resume')) {
        setLocked(true);
      }
    };
    const timer = window.setInterval(() => {
      if (shouldLock(configRef.current, lastActive.current, Date.now(), 'tick')) setLocked(true);
    }, TICK_MS);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const value = useMemo<AppLockState>(
    () => ({
      config,
      locked,
      async enable(label) {
        const credentialId = await services.appLock.register(label);
        update({ enabled: true, credentialId });
        lastActive.current = Date.now();
      },
      disable() {
        update({ enabled: false, credentialId: null });
      },
      setTimeoutMinutes(minutes) {
        update({ timeoutMinutes: minutes });
      },
      async unlock() {
        if (config.credentialId) await services.appLock.verify(config.credentialId);
        lastActive.current = Date.now();
        setLocked(false);
      },
    }),
    [config, locked, services.appLock, update],
  );

  return (
    <AppLockContext value={value}>
      {locked ? (
        <LockScreen
          onSignOut={async () => {
            // Recovery path: signing out clears this device's lock.
            update(DEFAULT_LOCK_CONFIG);
            setLocked(false);
            await services.auth.signOut();
          }}
        />
      ) : (
        children
      )}
    </AppLockContext>
  );
}
