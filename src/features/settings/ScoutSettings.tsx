import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { updateSettingsData } from '../../lib/db/settings';
import { MAX_SEARCHES, readScoutSettings, type ScoutSettings } from '../../lib/scout/settings';
import { FIELD_INLINE } from '../../ui/fieldParts';
import { Toggle } from '../../ui/Toggle';

const field = FIELD_INLINE;

/** Settings → Scout (Task 8.9): on or off, the city for web searches, and the search cap. */
export default function ScoutSettingsPanel() {
  const db = useDb();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const data = useLiveQuery(async () => {
    const [settings, runs] = await Promise.all([db.settings.get(userId), db.scout_runs.toArray()]);
    const last = runs
      .filter((r) => !r.deleted_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return { scout: readScoutSettings(settings), last };
  }, [db, userId]);
  const [city, setCity] = useState<string | null>(null);
  if (!data) return null;
  const { scout, last } = data;
  // Read the latest first, so two quick changes don't undo each other.
  const save = (patch: Partial<ScoutSettings>) =>
    void db.settings
      .get(userId)
      .then((row) =>
        updateSettingsData(db, userId, { scout: { ...readScoutSettings(row), ...patch } }),
      );

  return (
    <div className="space-y-3 text-footnote">
      <Toggle
        label="Scout for ideas each week (with the weekly review)"
        checked={scout.enabled}
        onChange={(v) => save({ enabled: v })}
      />
      <label className="flex flex-wrap items-center gap-2">
        City for web searches
        <input
          className={field}
          placeholder="e.g. Dublin"
          value={city ?? scout.city}
          onChange={(e) => setCity(e.target.value)}
          onBlur={() => {
            if (city !== null && city.trim() !== scout.city) save({ city: city.trim() });
          }}
        />
      </label>
      <label className="flex flex-wrap items-center gap-2">
        Web searches per run
        <select
          className={field}
          value={scout.max_searches}
          onChange={(e) => save({ max_searches: Number(e.target.value) })}
        >
          {Array.from({ length: MAX_SEARCHES + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n === 0 ? 'None (own data only)' : n}
            </option>
          ))}
        </select>
      </label>
      <p className="text-caption text-fg-muted">
        Searches use only your interests from Memory and this city, never names or personal details.
        Each search costs about €0.01.
      </p>
      {last && (
        <div aria-label="Last Scout run" className="rounded-lg bg-fill/50 p-2 text-caption">
          <p className="font-medium">
            Last run {last.created_at.slice(0, 10)}: {last.cards} ideas, {last.searches} searches
          </p>
          {last.queries.length > 0 && (
            <ul className="list-disc pl-5">
              {last.queries.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
