import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { leaveRangeText, saveLeave } from '../../lib/db/leave';
import { update } from '../../lib/db/repository';
import { countLeaveDays } from '../../lib/leave/engine';
import type { LeaveProposal } from '../../lib/leave/parse';
import { leaveTypeOf } from '../../lib/work/settings';
import { useWork } from './useWork';
import { Button } from '../../ui/Button';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';

/** Today cards for captures like "AL 14–18 July": book as planned leave, or dismiss. */
export default function LeaveProposals() {
  const db = useDb();
  const { user } = useAuth();
  const data = useWork();
  const captures = useLiveQuery(
    () =>
      db.captures
        .where('status')
        .equals('sorted')
        .filter(
          (c) =>
            !c.deleted_at &&
            !!c.payload.leave_proposal &&
            !c.payload.leave_booking_id &&
            !c.payload.leave_dismissed,
        )
        .toArray(),
    [db],
  );
  if (!data || !captures?.length) return null;

  return (
    <Section title="Leave to book">
      <GroupedList label="Leave to book">
        {captures.map((c) => {
          const p = c.payload.leave_proposal as LeaveProposal;
          const cost = countLeaveDays(p, data.work);
          return (
            <GroupedListItem key={c.id}>
              <p className="text-body font-medium">
                {leaveTypeOf(data.work, p.leave_type).name}: {leaveRangeText(p)}
              </p>
              <p className="text-footnote text-fg-muted">
                “{c.text}” · {cost} working day{cost === 1 ? '' : 's'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    void saveLeave(
                      db,
                      user?.id ?? '',
                      { ...p, status: 'planned', share_us: false, capture_id: c.id },
                      data.work,
                    ).then((b) =>
                      update(db, 'captures', c.id, {
                        payload: { ...c.payload, leave_booking_id: b.id },
                      }),
                    )
                  }
                >
                  Book as planned
                </Button>
                <Button
                  size="sm"
                  variant="plain"
                  onClick={() =>
                    void update(db, 'captures', c.id, {
                      payload: { ...c.payload, leave_dismissed: true },
                    })
                  }
                >
                  Dismiss
                </Button>
              </div>
            </GroupedListItem>
          );
        })}
      </GroupedList>
    </Section>
  );
}
