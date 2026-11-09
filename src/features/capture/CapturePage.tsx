import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import {
  captureChip,
  createCapture,
  isUrl,
  withWorkshop,
  type CaptureInput,
} from '../../lib/db/captures';
import { useDb } from '../../lib/db/context';
import { eventLabel, undoInstantEvent } from '../../lib/db/events';
import { sendCaptureToWorkshop } from '../../lib/db/workshop';
import type { AiAction, Capture, Item } from '../../lib/schemas/records';
import { TOAST_MS } from './toast';
import { Toast } from '../../ui/Toast';
import { compressImage } from '../../lib/files/image';
import NewNoteButtons from '../notes/NewNoteButtons';

const isTouch = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

function chipFor(c: Capture, items: Item[], actions: AiAction[]): string {
  // What sorting did (e.g. tidied the instant event) comes first.
  if (actions.some((a) => a.capture_id === c.id)) return captureChip(c, actions);
  const event = items.find((i) => i.capture_id === c.id && i.type === 'event' && !i.deleted_at);
  if (event?.status === 'open') return withWorkshop(c, `Event added: ${eventLabel(event)}`);
  if (event?.status === 'suggested') return withWorkshop(c, `Suggestion: ${eventLabel(event)}`);
  return captureChip(c, actions);
}

const button =
  'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500';

export default function CapturePage() {
  const db = useDb();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ itemId: string; label: string } | null>(null);

  const recent = useLiveQuery(
    () =>
      db.captures
        .orderBy('captured_at')
        .reverse()
        .filter((c) => !c.deleted_at)
        .limit(10)
        .toArray(),
    [db],
  );
  const recentIds = recent?.map((c) => c.id).join(',') ?? '';
  const recentItems = useLiveQuery(
    () => (recentIds ? db.items.where('capture_id').anyOf(recentIds.split(',')).toArray() : []),
    [db, recentIds],
  );

  const recentActions = useLiveQuery(
    () =>
      recentIds ? db.ai_actions.where('capture_id').anyOf(recentIds.split(',')).toArray() : [],
    [db, recentIds],
  );

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const canSave = text.trim().length > 0 || photo !== null;

  async function saveCapture(input: CaptureInput) {
    setError(null);
    try {
      const { event } = await createCapture(db, userId, input);
      setToast(
        event?.status === 'open'
          ? { itemId: event.id, label: `Event added: ${eventLabel(event)}` }
          : null,
      );
    } catch {
      setError('That capture could not be saved. Try again.');
      return false;
    }
    return true;
  }

  async function submit() {
    if (!canSave) return;
    const value = text.trim();
    const ok = await saveCapture({
      text: isUrl(value) ? null : value,
      url: isUrl(value) ? value : null,
      photo,
    });
    if (ok) {
      setText('');
      setPhoto(null);
      setPhotoName(null);
      if (fileRef.current) fileRef.current.value = '';
      boxRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Desktop: Enter saves, Shift+Enter adds a line. Touch: Enter adds a line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
      e.preventDefault();
      void submit();
    }
  }

  async function pasteLink() {
    setError(null);
    let clip = '';
    try {
      clip = (await navigator.clipboard.readText()).trim();
    } catch {
      setError('Airhead could not read the clipboard. Paste into the box instead.');
      return;
    }
    if (isUrl(clip)) {
      await saveCapture({ url: clip });
    } else if (clip) {
      setText((t) => (t ? `${t} ${clip}` : clip));
      boxRef.current?.focus();
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPhoto(await compressImage(file));
      setPhotoName(file.name);
    } catch {
      setError('That photo could not be attached.');
    }
  }

  return (
    <Page title="Capture">
      <div className="space-y-3">
        <textarea
          ref={boxRef}
          aria-label="Capture"
          placeholder="Anything on your mind?"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full resize-y rounded-xl border border-slate-300 bg-white p-4 text-base shadow-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${button} bg-indigo-600 text-white hover:bg-indigo-700`}
            disabled={!canSave}
            onClick={() => void submit()}
          >
            Save
          </button>
          <button
            type="button"
            className={`${button} bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700`}
            onClick={() => void pasteLink()}
          >
            Paste link
          </button>
          <label
            className={`${button} cursor-pointer bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700`}
          >
            {photoName ? 'Change photo' : 'Add photo'}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              aria-label="Attach photo"
              className="sr-only"
              onChange={(e) => void onPhoto(e.target.files?.[0])}
            />
          </label>
          {photoName && <span className="text-sm text-slate-500">📷 {photoName}</span>}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      {recent && recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Recent
          </h2>
          <ul aria-label="Recent captures" className="space-y-2">
            {recent.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800"
              >
                <span className="min-w-0 flex-1 break-words">
                  {c.kind === 'image' && <span aria-hidden="true">📷 </span>}
                  {c.text ?? c.url}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {chipFor(c, recentItems ?? [], recentActions ?? [])}
                  </span>
                  {typeof c.payload.workshop_item_id !== 'string' && (
                    <button
                      type="button"
                      className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      onClick={() => void sendCaptureToWorkshop(db, userId, c.id)}
                    >
                      Send to Workshop
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {toast && (
        <Toast
          key={toast.itemId}
          message={toast.label}
          duration={TOAST_MS}
          onDismiss={() => setToast(null)}
          action={{
            label: 'Undo',
            onClick: () => void undoInstantEvent(db, toast.itemId),
          }}
        />
      )}
      <div className="mt-8">
        <NewNoteButtons />
      </div>
    </Page>
  );
}
