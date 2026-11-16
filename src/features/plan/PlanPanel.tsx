import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '../../lib/db/context';
import { PLAN_KIND_LABELS, sourceLabel, whenLabel } from '../../lib/plan/plan';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';

/**
 * "Why now?" (Task 13.8): the item's plan (what to prepare, why) and each
 * upcoming reminder with its time, its reason and where it came from.
 * Nothing is shown for an item with no plan and no upcoming reminders.
 */
export function PlanPanel({ itemId }: { itemId: string }) {
  const db = useDb();
  const data = useLiveQuery(async () => {
    const now = new Date().toISOString();
    const plan = await db.item_plans.where('item_id').equals(itemId).first();
    const nudges = (await db.nudges.where('item_id').equals(itemId).toArray())
      .filter((n) => n.status === 'pending' && !n.deleted_at && n.send_at > now)
      .sort((a, b) => a.send_at.localeCompare(b.send_at));
    return { plan: plan && !plan.deleted_at ? plan : null, nudges };
  }, [db, itemId]);
  if (!data || (!data.plan && data.nudges.length === 0)) return null;
  const { plan, nudges } = data;

  return (
    <Section title="Why now?">
      <GroupedList label="Why now?">
        {plan && (plan.prep.length > 0 || plan.reason) && (
          <GroupedListItem>
            {plan.prep.length > 0 && <p className="text-body">Prepare: {plan.prep.join(', ')}</p>}
            {plan.reason && <p className="text-footnote text-fg-muted">{plan.reason}</p>}
            <p className="text-caption text-fg-muted">
              {plan.source === 'ai' ? 'Planned by AI' : 'Airhead’s defaults'}
            </p>
          </GroupedListItem>
        )}
        {nudges.map((n) => (
          <GroupedListItem key={n.id}>
            <p className="text-body">
              {whenLabel(n.send_at)} · {n.title || PLAN_KIND_LABELS[n.kind] || 'Reminder'}
            </p>
            {n.reason && <p className="text-footnote text-fg-muted">{n.reason}</p>}
            <p className="text-caption text-fg-muted">
              {PLAN_KIND_LABELS[n.kind] ?? 'Reminder'} · {sourceLabel(n.source)}
              {n.delivery === 'digest' ? ' · in the morning digest' : ''}
            </p>
          </GroupedListItem>
        ))}
      </GroupedList>
    </Section>
  );
}
