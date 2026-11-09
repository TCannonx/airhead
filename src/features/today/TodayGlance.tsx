import { Top3, TodayEvents } from './TodayParts';
import { useToday } from './useToday';

/** The desktop right panel: today's Top 3 and events at a glance (Task 5.7). */
export default function TodayGlance() {
  const view = useToday();
  if (!view) return null;
  return (
    <div aria-label="Today at a glance">
      <Top3 view={view} compact />
      <TodayEvents view={view} compact />
    </div>
  );
}
