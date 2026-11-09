import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import type { CaptureTokenRow } from '../../lib/capture/tokens';
import BookmarkletLink from './BookmarkletLink';
import ShortcutsGuide from './ShortcutsGuide';
import { Button } from '../../ui/Button';
import { FIELD_INLINE } from '../../ui/fieldParts';

const field = FIELD_INLINE;
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : 'never';

/**
 * Settings → Capture from anywhere (Task 7.1): tokens for iOS Shortcuts.
 * A new token is shown once (only its hash is kept); revoking one stops it.
 */
export default function CaptureTokens() {
  const { services } = useAuth();
  const tokens = services.captureTokens;
  const [rows, setRows] = useState<CaptureTokenRow[] | null>(null);
  const [label, setLabel] = useState('iPhone');
  const [fresh, setFresh] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!tokens) return;
    tokens.list().then(setRows, (e: Error) => setMessage(e.message));
  }, [tokens]);
  useEffect(load, [load]);

  if (!tokens)
    return (
      <div className="space-y-4">
        <p className="text-footnote text-fg-muted">
          Capturing from Shortcuts needs Airhead&apos;s server (sign in).
        </p>
        <BookmarkletLink />
      </div>
    );

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-footnote">
      <p className="text-fg-muted">
        A token lets an iOS Shortcut save captures to Airhead. Each device or Shortcut gets its own;
        revoke one if a phone is lost.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-caption text-fg-muted">
          Name
          <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <Button
          size="sm"
          disabled={busy || !label.trim()}
          onClick={() =>
            void act(async () => {
              setFresh(await tokens.create(label.trim()));
            })
          }
        >
          Create token
        </Button>
      </div>
      {fresh && (
        <div role="alert" className="rounded-card bg-warning-soft p-3 text-fg">
          <p className="mb-1 font-semibold">Copy this token now — it won&apos;t be shown again.</p>
          <code className="block break-all">{fresh}</code>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void navigator.clipboard?.writeText(fresh)}>
              Copy
            </Button>
            <Button size="sm" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-fg-muted">No tokens yet.</p>}
      <ul aria-label="Capture tokens" className="divide-y divide-border/70">
        {rows?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="font-medium">{t.label}</p>
              <p className="text-caption text-fg-muted">
                {t.revoked_at
                  ? `Revoked ${when(t.revoked_at)}`
                  : `Last used: ${when(t.last_used_at)}`}
              </p>
            </div>
            {!t.revoked_at && (
              <Button size="sm" disabled={busy} onClick={() => void act(() => tokens.revoke(t.id))}>
                Revoke {t.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className="text-warning">
          {message}
        </p>
      )}
      <ShortcutsGuide />
      <BookmarkletLink />
    </div>
  );
}
