import { useSync } from '../../lib/sync/context';
import type { SyncStatus } from '../../lib/sync/types';
import { syncLabel } from './labels';

const DOT: Record<SyncStatus['state'], string> = {
  idle: 'bg-emerald-500',
  syncing: 'bg-sky-500 animate-pulse',
  offline: 'bg-slate-400',
  error: 'bg-amber-500',
};

/** Small sync status (hidden in local mode, where nothing syncs). */
export function SyncIndicator({ className = '' }: { className?: string }) {
  const { status } = useSync();
  if (!status) return null;
  const label = syncLabel(status);
  const dot = status.state === 'idle' && status.pending > 0 ? 'bg-amber-500' : DOT[status.state];
  return (
    <span
      title={status.message ?? label}
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      <span>{label}</span>
    </span>
  );
}
