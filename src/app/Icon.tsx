export type IconName = 'capture' | 'today' | 'inbox' | 'library' | 'insights' | 'settings';

// Simple 24px stroke icons drawn for Airhead (no icon library needed yet).
const PATHS: Record<IconName, string> = {
  capture: 'M12 5v14M5 12h14',
  today: 'M4 7h16v13H4zM4 11h16M8 3v4M16 3v4',
  inbox: 'M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5',
  library: 'M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.5-1 2.5 15.5-3.5 1z',
  insights: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1.5-2-3.5-2.4.8a7 7 0 0 0-1.6-.9L14.5 4h-5l-.5 2.9a7 7 0 0 0-1.6.9L5 7 3 10.5 5 12l-2 1.5L5 17l2.4-.8c.5.4 1 .7 1.6.9l.5 2.9h5l.5-2.9c.6-.2 1.1-.5 1.6-.9L19 17l2-3.5z',
};

export function Icon({ name, className = 'size-6' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
