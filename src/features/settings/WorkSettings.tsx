import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import { WORK_LOCATIONS, type WorkLocation } from '../../lib/schemas/records';
import {
  LOCATION_LABELS,
  readWorkSettings,
  workSettingsSchema,
  type LeaveType,
  type WorkSettings as Work,
} from '../../lib/work/settings';

const small =
  'rounded-md px-2 py-1 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800';
const field =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
const num = `${field} w-20`;
/** Monday first, as people read a week. */
const WEEK: [number, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKEND_RULES: [Work['weekend_holiday'], string][] = [
  ['day_off', 'A paid day off within a month'],
  ['extra_leave', 'An extra day of annual leave'],
  ['extra_pay', 'An extra day’s pay'],
];
const SHARING: [Work['location_sharing'], string][] = [
  ['full', 'Where I am (WFH, Office, …)'],
  ['working', 'Just “Working” or “Off”'],
  ['none', 'Nothing'],
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'type';

function WorkForm({
  initial,
  onSave,
  saved,
  onEdit,
}: {
  initial: Work;
  onSave: (w: Work) => Promise<void>;
  saved: boolean;
  onEdit: () => void;
}) {
  const [w, setW] = useState<Work>(initial);
  const [closure, setClosure] = useState('');
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const [newType, setNewType] = useState('');
  const set = <K extends keyof Work>(key: K, value: Work[K]) => {
    onEdit();
    setW((prev) => ({ ...prev, [key]: value }));
  };
  const [startMonth, startDay] = w.leave_year_start.split('-').map(Number) as [number, number];
  const valid = workSettingsSchema.safeParse(w).success;
  const dirty = JSON.stringify(w) !== JSON.stringify(initial);

  const setStart = (month: number, day: number) =>
    set(
      'leave_year_start',
      `${String(month).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`,
    );
  const setType = (i: number, patch: Partial<LeaveType>) =>
    set(
      'leave_types',
      w.leave_types.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void onSave(w);
      }}
    >
      <Group title="Working days">
        <div className="flex flex-wrap gap-3">
          {WEEK.map(([d, label]) => (
            <label key={d} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={w.working_days.includes(d)}
                onChange={(e) =>
                  set(
                    'working_days',
                    e.target.checked
                      ? [...w.working_days, d].sort()
                      : w.working_days.filter((x) => x !== d),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          Hours per day
          <input
            type="number"
            step="0.25"
            min="1"
            max="24"
            className={num}
            value={w.hours_per_day}
            onChange={(e) => set('hours_per_day', Number(e.target.value))}
          />
        </label>
      </Group>

      <Group title="Leave">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Leave year starts on
          <select
            aria-label="Leave year start day"
            className={field}
            value={startDay}
            onChange={(e) => setStart(startMonth, Number(e.target.value))}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            aria-label="Leave year start month"
            className={field}
            value={startMonth}
            onChange={(e) => setStart(Number(e.target.value), startDay)}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Annual leave (days a year)
          <input
            type="number"
            step="0.5"
            min="0"
            className={num}
            value={w.entitlement}
            onChange={(e) => set('entitlement', Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Most days carried over
          <input
            type="number"
            step="0.5"
            min="0"
            className={num}
            value={w.carry_over_max}
            onChange={(e) => set('carry_over_max', Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Carried-over days expire
          <select
            className={field}
            value={w.carry_over_expiry_months ?? 'never'}
            onChange={(e) =>
              set(
                'carry_over_expiry_months',
                e.target.value === 'never' ? null : Number(e.target.value),
              )
            }
          >
            <option value="never">Never</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m} month{m === 1 ? '' : 's'} into the new year
              </option>
            ))}
          </select>
        </label>
      </Group>

      <Group title="Public holiday on a day I don’t work">
        {WEEKEND_RULES.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="weekend_holiday"
              checked={w.weekend_holiday === value}
              onChange={() => set('weekend_holiday', value)}
            />
            {label}
          </label>
        ))}
      </Group>

      <Group title="Company closure days">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={w.closure_uses_leave}
            onChange={(e) => set('closure_uses_leave', e.target.checked)}
          />
          Closure days come out of my annual leave
        </label>
        <ul aria-label="Closure days" className="text-sm">
          {w.closure_days.map((d) => (
            <li key={d} className="flex items-center gap-2">
              {d}
              <button
                type="button"
                className={small}
                aria-label={`Remove closure day ${d}`}
                onClick={() =>
                  set(
                    'closure_days',
                    w.closure_days.filter((x) => x !== d),
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="date"
            aria-label="Closure day"
            className={field}
            value={closure}
            onChange={(e) => setClosure(e.target.value)}
          />
          <button
            type="button"
            className={small}
            disabled={!closure || w.closure_days.includes(closure)}
            onClick={() => {
              set('closure_days', [...w.closure_days, closure].sort());
              setClosure('');
            }}
          >
            Add closure day
          </button>
        </div>
      </Group>

      <Group title="Extra one-off holidays">
        <ul aria-label="One-off holidays" className="text-sm">
          {w.manual_holidays.map((h) => (
            <li key={h.date} className="flex items-center gap-2">
              {h.date} · {h.name}
              <button
                type="button"
                className={small}
                aria-label={`Remove holiday ${h.name}`}
                onClick={() =>
                  set(
                    'manual_holidays',
                    w.manual_holidays.filter((x) => x.date !== h.date),
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            aria-label="Holiday date"
            className={field}
            value={holiday.date}
            onChange={(e) => setHoliday({ ...holiday, date: e.target.value })}
          />
          <input
            aria-label="Holiday name"
            placeholder="Name"
            className={field}
            value={holiday.name}
            onChange={(e) => setHoliday({ ...holiday, name: e.target.value })}
          />
          <button
            type="button"
            className={small}
            disabled={
              !holiday.date ||
              !holiday.name.trim() ||
              w.manual_holidays.some((h) => h.date === holiday.date)
            }
            onClick={() => {
              set(
                'manual_holidays',
                [...w.manual_holidays, { date: holiday.date, name: holiday.name.trim() }].sort(
                  (a, b) => a.date.localeCompare(b.date),
                ),
              );
              setHoliday({ date: '', name: '' });
            }}
          >
            Add holiday
          </button>
        </div>
      </Group>

      <Group title="Leave types">
        <ul aria-label="Leave types" className="space-y-1">
          {w.leave_types.map((t, i) => (
            <li key={t.key} className="flex flex-wrap items-center gap-2 text-sm">
              <input
                aria-label={`Leave type ${i + 1} name`}
                className={field}
                value={t.name}
                onChange={(e) => setType(i, { name: e.target.value })}
              />
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={t.deducts}
                  disabled={t.key === 'annual'}
                  onChange={(e) => setType(i, { deducts: e.target.checked })}
                />
                Uses annual leave
              </label>
              {t.key !== 'annual' && (
                <button
                  type="button"
                  className={small}
                  onClick={() =>
                    set(
                      'leave_types',
                      w.leave_types.filter((_, j) => j !== i),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            aria-label="New leave type"
            placeholder="e.g. Compassionate"
            className={field}
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
          />
          <button
            type="button"
            className={small}
            disabled={!newType.trim() || w.leave_types.some((t) => t.key === slug(newType.trim()))}
            onClick={() => {
              set('leave_types', [
                ...w.leave_types,
                { key: slug(newType.trim()), name: newType.trim(), deducts: false },
              ]);
              setNewType('');
            }}
          >
            Add leave type
          </button>
        </div>
      </Group>

      <Group title="Usual week">
        <ul aria-label="Usual week" className="space-y-1">
          {WEEK.filter(([d]) => w.working_days.includes(d)).map(([d, label]) => (
            <li key={d} className="flex items-center gap-2 text-sm">
              <span className="w-10">{label}</span>
              <select
                aria-label={`${label} location`}
                className={field}
                value={w.location_pattern[String(d) as '0'] ?? 'office'}
                onChange={(e) =>
                  set('location_pattern', {
                    ...w.location_pattern,
                    [String(d)]: e.target.value as WorkLocation,
                  })
                }
              >
                {WORK_LOCATIONS.filter((l) => l !== 'off').map((l) => (
                  <option key={l} value={l}>
                    {LOCATION_LABELS[l]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Checklist the evening before (one per line)">
        {WORK_LOCATIONS.filter((l) => l !== 'off').map((l) => (
          <label key={l} className="block text-sm">
            {LOCATION_LABELS[l]}
            <textarea
              aria-label={`${LOCATION_LABELS[l]} checklist`}
              rows={2}
              className={`${field} mt-1 block w-full`}
              value={(w.checklists[l] ?? []).join('\n')}
              onChange={(e) =>
                set('checklists', {
                  ...w.checklists,
                  [l]: e.target.value.split('\n'),
                })
              }
            />
          </label>
        ))}
      </Group>

      <Group title="Shown on the Us calendar each working day">
        <select
          aria-label="Location sharing"
          className={field}
          value={w.location_sharing}
          onChange={(e) => set('location_sharing', e.target.value as Work['location_sharing'])}
        >
          {SHARING.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </Group>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || !valid}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Save work settings
        </button>
        {!valid && (
          <span role="alert" className="text-sm text-red-600">
            Check the numbers above.
          </span>
        )}
        {saved && !dirty && <span className="text-sm text-slate-500">Saved</span>}
      </div>
    </form>
  );
}

/** Settings → Work (Task 4.4): working pattern, leave rules, holidays and locations. */
export default function WorkSettings() {
  const db = useDb();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const settings = useLiveQuery(() => db.settings.get(userId), [db, userId], null);
  const [saved, setSaved] = useState(false);
  if (settings === null) return <p className="text-sm text-slate-500">Loading…</p>;
  const work = readWorkSettings(settings);
  const clean = (w: Work): Work => ({
    ...w,
    checklists: Object.fromEntries(
      Object.entries(w.checklists).map(([k, v]) => [
        k,
        (v ?? []).map((x) => x.trim()).filter(Boolean),
      ]),
    ),
  });
  return (
    <WorkForm
      key={JSON.stringify(work)}
      initial={work}
      saved={saved}
      onEdit={() => setSaved(false)}
      onSave={async (w) => {
        await updateSettingsData(db, userId, { work: clean(w) });
        setSaved(true);
      }}
    />
  );
}
