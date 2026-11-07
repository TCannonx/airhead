import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { leaveRangeText, saveLeave } from '../../lib/db/leave';
import { update } from '../../lib/db/repository';
import { countLeaveDays } from '../../lib/leave/engine';
import type { LeaveProposal } from '../../lib/leave/parse';
import { leaveTypeOf } from '../../lib/work/settings';
import { useWork } from './useWork';

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
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Leave to book
      </h2>
      <ul aria-label="Leave to book" className="space-y-2">
        {captures.map((c) => {
          const p = c.payload.leave_proposal as LeaveProposal;
          const cost = countLeaveDays(p, data.work);
          return (
            <li
              key={c.id}
              className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40"
            >
              <p className="font-medium">
                {leaveTypeOf(data.work, p.leave_type).name}: {leaveRangeText(p)}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                “{c.text}” · {cost} working day{cost === 1 ? '' : 's'}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600"
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
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={() =>
                    void update(db, 'captures', c.id, {
                      payload: { ...c.payload, leave_dismissed: true },
                    })
                  }
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
