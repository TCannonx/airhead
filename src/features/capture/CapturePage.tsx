import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { captureChip, createCapture, isUrl, type CaptureInput } from '../../lib/db/captures';
import { useDb } from '../../lib/db/context';
import { compressImage } from '../../lib/files/image';

const isTouch = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

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

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const canSave = text.trim().length > 0 || photo !== null;

  async function saveCapture(input: CaptureInput) {
    setError(null);
    try {
      await createCapture(db, userId, input);
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
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {captureChip(c)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
