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

const small =
  'rounded-md px-2 py-1 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800';
const field =
  'min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';

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
      <span className="hidden text-xs text-slate-500 sm:inline">{CATEGORY[fact.category]}</span>
      <button
        type="button"
        className={small}
        disabled={text.trim() === fact.text || !text.trim()}
        onClick={() => void editFact(db, fact.id, text)}
      >
        Save
      </button>
      <button
        type="button"
        className={`${small} text-red-600`}
        onClick={() => void rejectFact(db, fact.id)}
      >
        Delete
      </button>
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
      <p className="text-sm text-slate-500">
        Short facts Airhead uses to sort your captures better. It learns everyday facts on its own;
        facts about people and personal details wait for your OK. Facts unused for six months are
        archived.
      </p>

      {by('pending_approval').length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium">Waiting for your OK</h3>
          <ul
            aria-label="Waiting for your OK"
            className="divide-y divide-slate-100 dark:divide-slate-800"
          >
            {by('pending_approval').map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-sm">
                  {f.text} <span className="text-xs text-slate-500">({CATEGORY[f.category]})</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className={`${small} text-indigo-600 dark:text-indigo-400`}
                    onClick={() => void approveFact(db, f.id)}
                  >
                    Remember
                  </button>
                  <button type="button" className={small} onClick={() => void rejectFact(db, f.id)}>
                    Forget
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-sm font-medium">What Airhead knows about me</h3>
        {by('active').length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
        <ul aria-label="Known facts" className="divide-y divide-slate-100 dark:divide-slate-800">
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
            className="rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
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
          <h3 className="mb-1 text-sm font-medium text-slate-500">
            Archived (not used for six months)
          </h3>
          <ul
            aria-label="Archived facts"
            className="divide-y divide-slate-100 dark:divide-slate-800"
          >
            {by('archived').map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2 py-1.5 text-sm text-slate-500"
              >
                {f.text}
                <button type="button" className={small} onClick={() => void restoreFact(db, f.id)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-sm font-medium">Learned rules</h3>
        <p className="mb-1 text-xs text-slate-500">
          After the same kind of capture has been sorted the same way four times, Airhead sorts it
          instantly on your device. Correcting one switches its rule off.
        </p>
        {rules?.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        <ul aria-label="Learned rules" className="divide-y divide-slate-100 dark:divide-slate-800">
          {rules?.map((r) => {
            const target =
              r.result.type === 'list_entry' && r.result.list_id
                ? `${listName.get(r.result.list_id) ?? 'a'} list`
                : TYPE_LABELS[r.result.type];
            const label = `“${r.pattern} …” → ${target}`;
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span>
                  {label} <span className="text-xs text-slate-500">· used {r.hits}×</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.enabled}
                  aria-label={`Rule ${label}`}
                  onClick={() => void setRuleEnabled(db, r.id, !r.enabled)}
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${r.enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${r.enabled ? 'left-4.5' : 'left-0.5'}`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
