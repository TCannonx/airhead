import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Toggle';

/**
 * Show or hide each calendar (Task 11.6), with its colour. A Sheet on the
 * phone, the side area on iPad and desktop; remembered on this device.
 */
export default function CalendarsPanel({
  sources,
  hidden,
  onToggle,
  onShowAll,
}: {
  sources: { key: string; label: string; colour: string }[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onShowAll: () => void;
}) {
  const anyHidden = sources.some((s) => hidden.has(s.key));
  return (
    <div role="group" aria-label="Calendars">
      <ul className="divide-y divide-border rounded-card bg-surface px-4">
        {sources.map((s) => (
          <li key={s.key} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              data-testid="calendar-colour"
              className="size-3 shrink-0 rounded-full"
              style={{
                background: hidden.has(s.key) ? 'transparent' : s.colour,
                border: `2px solid ${s.colour}`,
              }}
            />
            <Toggle
              className="min-w-0 flex-1"
              label={s.label}
              checked={!hidden.has(s.key)}
              onChange={() => onToggle(s.key)}
            />
          </li>
        ))}
      </ul>
      {anyHidden && (
        <Button variant="plain" size="sm" className="mt-2" onClick={onShowAll}>
          Show all calendars
        </Button>
      )}
    </div>
  );
}
