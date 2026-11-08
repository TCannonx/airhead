import { describe, expect, it, vi } from 'vitest';
import { loadLatestVersion } from './loadLatest';

const win = () => ({ location: { reload: vi.fn() } }) as unknown as Pick<Window, 'location'>;

describe('Load latest version', () => {
  it('checks for a new build, waits for it to take over, then reloads', async () => {
    const listeners: Record<string, () => void> = {};
    const reg = {
      update: vi.fn(async () => {}),
      installing: {},
      waiting: null,
    };
    const sw = {
      getRegistration: vi.fn(async () => reg),
      addEventListener: (name: string, fn: () => void) => {
        listeners[name] = fn;
      },
    } as unknown as ServiceWorkerContainer;
    const w = win();
    const done = loadLatestVersion(w, sw, 10_000);
    await vi.waitFor(() => expect(listeners.controllerchange).toBeDefined());
    expect(w.location.reload).not.toHaveBeenCalled();
    listeners.controllerchange?.();
    await done;
    expect(reg.update).toHaveBeenCalled();
    expect(w.location.reload).toHaveBeenCalledOnce();
  });

  it('reloads anyway when there is no service worker or the check fails', async () => {
    const w1 = win();
    await loadLatestVersion(w1, undefined);
    expect(w1.location.reload).toHaveBeenCalledOnce();
    const failing = {
      getRegistration: vi.fn(async () => {
        throw new Error('offline');
      }),
    } as unknown as ServiceWorkerContainer;
    const w2 = win();
    await loadLatestVersion(w2, failing);
    expect(w2.location.reload).toHaveBeenCalledOnce();
  });
});
