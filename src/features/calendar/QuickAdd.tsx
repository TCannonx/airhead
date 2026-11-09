import { useState } from 'react';
import {
  parseQuickAdd,
  quickDraftTimes,
  quickItem,
  quickPreview,
} from '../../lib/calendar/quickAdd';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { save } from '../../lib/db/repository';
import type { Item } from '../../lib/schemas/records';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import type { EventDraft } from './EventEditor';

/**
 * Quick add (Task 11.4): type "Dentist Fri 3pm", see what it will be, press
 * Enter. The same free rules as Capture read the text; "More options" opens
 * the full form filled in.
 */
export default function QuickAdd({
  timeZone,
  day,
  onMore,
  onAdded,
}: {
  timeZone: string;
  /** The day used when the text has no date (the selected day). */
  day?: string;
  onMore: (draft: EventDraft) => void;
  onAdded?: (item: Item) => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const parsed = parseQuickAdd(text, { timeZone, day });
  const preview = parsed ? quickPreview(parsed, timeZone) : null;
  const canAdd = !!parsed?.title.trim();

  async function add() {
    if (!parsed || !canAdd) return;
    const item = await save(db, 'items', quickItem(user?.id ?? '', parsed));
    setText('');
    onAdded?.(item);
  }

  function more() {
    const q = parsed;
    setText('');
    if (!q) {
      onMore({ start: new Date(), end: null, allDay: false });
      return;
    }
    onMore({
      ...quickDraftTimes(q, timeZone),
      allDay: q.allDay,
      title: q.title,
      rrule: q.rrule,
      calendar: q.calendar,
    });
  }

  return (
    <form
      aria-label="Quick add"
      className="mb-3"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <TextField
        label="Quick add"
        hideLabel
        placeholder="Add an event, e.g. “Dentist Fri 3pm”"
        enterKeyHint="done"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {preview && (
        <div
          aria-label="Quick add preview"
          role="group"
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-surface px-4 py-2.5"
        >
          <div aria-live="polite" className="min-w-0 flex-1 text-footnote">
            <p className="truncate text-body font-semibold">{preview.title}</p>
            <p className="text-fg-muted">
              {preview.when}
              {!parsed?.dated && ' (no date found)'}
            </p>
            <p className="text-fg-muted">
              {[preview.repeat, preview.calendar].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="plain" onClick={more}>
              More options
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canAdd}>
              Add
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
