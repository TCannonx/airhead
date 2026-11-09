import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import {
  addFact,
  approveFact,
  editFact,
  rejectFact,
  restoreFact,
  setRuleEnabled,
} from '../../lib/db/memory';
import { TYPE_LABELS } from '../../lib/db/sorting';
import type { MemoryFact } from '../../lib/schemas/records';
import { Button } from '../../ui/Button';
import { FIELD_INLINE } from '../../ui/fieldParts';
import { Toggle } from '../../ui/Toggle';

const field = `${FIELD_INLINE} min-w-0 flex-1`;

const CATEGORY: Record<MemoryFact['category'], string> = {
  everyday: 'Everyday',
  person: 'About a person',
  personal: 'Personal',
};

function KnownFact({ fact }: { fact: MemoryFact }) {
  const db = useDb();
  const [text, setText] = useState(fact.text);
  return (
    <li className="flex items-center gap-2 py-1.5">
      <input
        aria-label="Fact"
        className={field}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="hidden text-caption text-fg-muted sm:inline">{CATEGORY[fact.category]}</span>
      <Button
        size="sm"
        disabled={text.trim() === fact.text || !text.trim()}
        onClick={() => void editFact(db, fact.id, text)}
      >
        Save
      </Button>
      <Button
        variant="destructive"
        size="sm"

        onClick={() => void rejectFact(db, fact.id)}
      >
        Delete
      </Button>
    </li>
  );
}

/** Settings → What Airhead knows about me, and learned rules (Task 3.9). */
export default function MemorySettings() {
  const db = useDb();
  const { user } = useAuth();
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<MemoryFact['category']>('everyday');
  const facts = useLiveQuery(
    () => db.memory_facts.filter((f) => !f.deleted_at).sortBy('created_at'),
    [db],
  );
  const rules = useLiveQuery(
    () => db.learned_rules.filter((r) => !r.deleted_at).sortBy('pattern'),
    [db],
  );
  const lists = useLiveQuery(() => db.lists.toArray(), [db]);
  const listName = new Map(lists?.map((l) => [l.id, l.name]));

  const by = (s: MemoryFact['status']) => facts?.filter((f) => f.status === s) ?? [];

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await addFact(db, user?.id ?? '', draft, category);
    setDraft('');
  }

  return (
    <div className="space-y-5">
      <p className="text-footnote text-fg-muted">
        Short facts Airhead uses to sort your captures better. It learns everyday facts on its own;
        facts about people and personal details wait for your OK. Facts unused for six months are
        archived.
      </p>

      {by('pending_approval').length > 0 && (
        <div>
          <h3 className="mb-1 text-footnote font-medium">Waiting for your OK</h3>
          <ul aria-label="Waiting for your OK" className="divide-y divide-border/70">
            {by('pending_approval').map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-footnote">
                  {f.text}{' '}
                  <span className="text-caption text-fg-muted">({CATEGORY[f.category]})</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="plain"
                    size="sm"

                    onClick={() => void approveFact(db, f.id)}
                  >
                    Remember
                  </Button>
                  <Button size="sm" onClick={() => void rejectFact(db, f.id)}>
                    Forget
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-footnote font-medium">What Airhead knows about me</h3>
        {by('active').length === 0 && <p className="text-footnote text-fg-muted">Nothing yet.</p>}
        <ul aria-label="Known facts" className="divide-y divide-border/70">
          {by('active').map((f) => (
            <KnownFact key={f.id} fact={f} />
          ))}
        </ul>
        <form onSubmit={(e) => void onAdd(e)} className="mt-2 flex gap-2">
          <input
            aria-label="Add a fact"
            placeholder="Add a fact (e.g. Lives in Dublin)"
            className={field}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <select
            aria-label="Kind of fact"
            className="rounded-lg border border-border bg-surface px-2 text-footnote"
            value={category}
            onChange={(e) => setCategory(e.target.value as MemoryFact['category'])}
          >
            {Object.entries(CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </form>
      </div>

      {by('archived').length > 0 && (
        <div>
          <h3 className="mb-1 text-footnote font-medium text-fg-muted">
            Archived (not used for six months)
          </h3>
          <ul aria-label="Archived facts" className="divide-y divide-border/70">
            {by('archived').map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2 py-1.5 text-footnote text-fg-muted"
              >
                {f.text}
                <Button size="sm" onClick={() => void restoreFact(db, f.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-footnote font-medium">Learned rules</h3>
        <p className="mb-1 text-caption text-fg-muted">
          After the same kind of capture has been sorted the same way four times, Airhead sorts it
          instantly on your device. Correcting one switches its rule off.
        </p>
        {rules?.length === 0 && <p className="text-footnote text-fg-muted">None yet.</p>}
        <ul aria-label="Learned rules" className="divide-y divide-border/70">
          {rules?.map((r) => {
            const target =
              r.result.type === 'list_entry' && r.result.list_id
                ? `${listName.get(r.result.list_id) ?? 'a'} list`
                : TYPE_LABELS[r.result.type];
            const label = `“${r.pattern} …” → ${target}`;
            return (
              <li key={r.id}>
                <Toggle
                  label={label}
                  hint={`Used ${r.hits}×`}
                  checked={r.enabled}
                  onChange={() => void setRuleEnabled(db, r.id, !r.enabled)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
