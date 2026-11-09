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
import { Button } from '../../ui/Button';
import { buttonClasses } from '../../ui/buttonClasses';
import { Chip } from '../../ui/Chip';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { TextArea } from '../../ui/TextArea';
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
        <TextArea
          ref={boxRef}
          label="Capture"
          hideLabel
          placeholder="Anything on your mind?"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="[&_textarea]:rounded-card [&_textarea]:p-4 [&_textarea]:shadow-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!canSave} onClick={() => void submit()}>
            Save
          </Button>
          <Button onClick={() => void pasteLink()}>Paste link</Button>
          <label className={buttonClasses('secondary', 'md', 'cursor-pointer')}>
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
          {photoName && (
            <Chip className="max-w-full">
              <span className="truncate">📷 {photoName}</span>
            </Chip>
          )}
        </div>
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
      </div>

      {recent && recent.length > 0 && (
        <Section title="Recent" className="mt-8">
          <GroupedList label="Recent captures">
            {recent.map((c) => (
              <GroupedListItem key={c.id} className="py-2.5">
                <p className="text-body break-words">
                  {c.kind === 'image' && <span aria-hidden="true">📷 </span>}
                  {c.text ?? c.url}
                </p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
                  <Chip>{chipFor(c, recentItems ?? [], recentActions ?? [])}</Chip>
                  {typeof c.payload.workshop_item_id !== 'string' && (
                    <Button
                      variant="plain"
                      size="sm"
                      className="-mr-3"
                      onClick={() => void sendCaptureToWorkshop(db, userId, c.id)}
                    >
                      Send to Workshop
                    </Button>
                  )}
                </div>
              </GroupedListItem>
            ))}
          </GroupedList>
        </Section>
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
      <Section title="Notes" className="mt-8">
        <NewNoteButtons />
      </Section>
    </Page>
  );
}
