/**
 * The code-built daily list (Task 5.5): used when the morning brief's AI call
 * fails or is capped, and on the device before any brief exists (offline).
 *
 * No imports on purpose: copied to supabase/functions/_shared/today/fallback.ts,
 * and a Deno test checks the copies are identical.
 */
export interface ListTask {
  id: string;
  title: string;
  /** Local due date and time, "YYYY-MM-DD HH:MM", or null. */
  due: string | null;
  /** Already in today's Top 3 (chosen by hand or by an earlier brief). */
  top3: boolean;
  carry_count: number;
  age_days: number;
}

export interface DailyList {
  top3: string[];
  also_today: string[];
}

type Group = 0 | 1 | 2 | 3 | 4;

/**
 * Today's Top 3 first, then overdue (oldest due first), then due today (by
 * time), then the most carried over, then the oldest. Ties keep the title order.
 */
function group(t: ListTask, today: string): Group {
  if (t.top3) return 0;
  const dueDate = t.due?.slice(0, 10) ?? null;
  if (dueDate && dueDate < today) return 1;
  if (dueDate === today) return 2;
  if (t.carry_count > 0) return 3;
  return 4;
}

export function rankTasks(tasks: ListTask[], today: string): ListTask[] {
  return [...tasks].sort((a, b) => {
    const ga = group(a, today);
    const gb = group(b, today);
    if (ga !== gb) return ga - gb;
    if (ga === 1 || ga === 2) {
      const byDue = (a.due ?? '').localeCompare(b.due ?? '');
      if (byDue) return byDue;
    }
    if (b.carry_count !== a.carry_count) return b.carry_count - a.carry_count;
    if (b.age_days !== a.age_days) return b.age_days - a.age_days;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Top 3 = the first three by rank. Also today = the rest of what is due by
 * today or carried over (not every open task: the list stays short).
 */
export function fallbackList(tasks: ListTask[], today: string, max = 3): DailyList {
  const ranked = rankTasks(tasks, today);
  const top3 = ranked.slice(0, max).map((t) => t.id);
  const also_today = ranked
    .slice(max)
    .filter((t) => group(t, today) <= 3)
    .slice(0, 10)
    .map((t) => t.id);
  return { top3, also_today };
}
