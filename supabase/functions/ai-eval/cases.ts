// The owner's own requests (2026-11-08/09), as an evaluation set for the real
// sorting model. Each case says what the owner meant; `check` lists what is
// wrong with the plan for that capture (empty = pass). Nothing is written to
// the database: the plan is only inspected.
import type { ActionContext } from '../sort-batch/actions.ts';
import type { Candidate } from '../sort-batch/candidates.ts';
import type { InstantRow, PlannedItem, SortPlan } from '../sort-batch/plan.ts';

export interface EvalCase {
  id: string;
  text: string;
  /** For a note case: sent as a typed note instead of a capture. */
  note?: boolean;
  /** The event the instant rule already made (Task 11.1). */
  instant?: Omit<InstantRow, 'id' | 'updated_at' | 'deleted_at' | 'status'>;
  meant: string;
  check: (r: CaseView) => string[];
}

export interface CaseView {
  items: PlannedItem[];
  actions: SortPlan['actions'];
  updates: SortPlan['item_updates'];
  workshop: SortPlan['workshop'];
  /** Questions asked about this capture (Task 12.1). */
  follow_ups: SortPlan['follow_ups'];
  status: string | undefined;
  timeZone: string;
}

const TZ = 'Europe/Dublin';

/** Local weekday (0 = Sunday) and HH:MM of an instant. */
export function local(iso: string, timeZone = TZ): { day: number; hm: string; date: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    day,
    hm: `${get('hour')}:${get('minute')}`,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** The next date after `now` on `weekday` at local hour:00, as UTC ISO (approximate offset is fine for checks). */
function nextLocal(now: Date, weekday: number, hour: number): string {
  const d = new Date(now);
  d.setUTCHours(hour, 0, 0, 0);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== weekday);
  return d.toISOString();
}

const has = (cond: boolean, msg: string) => (cond ? [] : [msg]);
const titled = (items: PlannedItem[], re: RegExp) => items.find((i) => re.test(i.title));

export function evalCases(now: Date): {
  cases: EvalCase[];
  candidates: Candidate[];
  ids: Record<string, string>;
} {
  const ids = {
    dentist: 'e0000000-0000-4000-8000-0000000000d1',
    meetA: 'e0000000-0000-4000-8000-0000000000a1',
    meetB: 'e0000000-0000-4000-8000-0000000000b1',
  };
  const candidates: Candidate[] = [
    {
      id: ids.dentist,
      type: 'event',
      title: 'Dentist',
      when: nextLocal(now, 2, 15),
      repeats: false,
    },
    {
      id: ids.meetA,
      type: 'event',
      title: 'Team meeting',
      when: nextLocal(now, 1, 9),
      repeats: false,
    },
    {
      id: ids.meetB,
      type: 'event',
      title: 'Team meeting',
      when: nextLocal(now, 3, 9),
      repeats: false,
    },
  ];
  const trainingStart = nextLocal(now, 2, 0).slice(0, 10) + 'T00:00:00.000Z';

  const cases: EvalCase[] = [
    {
      id: 'leave-left',
      text: 'I have used annual leave already this year. I have 9.5 days left from now till end of November',
      meant: 'Set the leave balance so 9.5 days are left (no new task or event).',
      check: (r) => [
        ...has(
          r.actions.some((a) => a.kind === 'set_leave_remaining' && a.status !== 'skipped'),
          'no set_leave_remaining action',
        ),
        ...has(!r.items.some((i) => i.type === 'event'), 'made an event'),
      ],
    },
    {
      id: 'haircut',
      text: 'I get a haircut every 2-3 weeks. Requires €20 cash. Remind me every 2-3 weeks to text barber for haircut and once booked, ensure I have cash for appointment',
      meant:
        'A repeating task (every 2 weeks, with a first due time) to text the barber, and a standing prep rule: bring €20 cash before barber/haircut events.',
      check: (r) => {
        const task = r.items.find((i) => i.type === 'task' && /barber/i.test(i.title));
        const rule = r.actions.find((a) => a.kind === 'add_prep_rule');
        const after = (
          rule?.after?.prep_rules as { match: string[]; reminder: string }[] | undefined
        )?.at(-1);
        return [
          ...has(!!task, 'no task to text the barber'),
          ...has(
            !!task?.rrule && /FREQ=WEEKLY/.test(task.rrule),
            'the barber task does not repeat weekly',
          ),
          ...has(!!task?.due_at, 'the barber task has no first due time'),
          ...has(!!rule, 'no prep rule'),
          ...has(
            !!after && /20/.test(after.reminder) && /cash/i.test(after.reminder),
            'the prep reminder does not mention €20 cash',
          ),
          ...has(
            !!after && after.match.some((w) => /barber|haircut/i.test(w)),
            'the prep rule does not match barber/haircut',
          ),
          ...has(
            !r.items.some((i) => i.type === 'task' && /cash/i.test(i.title)),
            'also made a one-off cash task',
          ),
        ];
      },
    },
    {
      id: 'training-report',
      text: 'Training on Tuesday. Need a reminder to send report to Trevor',
      instant: {
        title: 'Training . Need a reminder to send report to Trevor',
        start_at: trainingStart,
        end_at: null,
        all_day: true,
        rrule: null,
      },
      meant:
        'The instant event is tidied to "Training", and a task "Send report to Trevor" is added.',
      check: (r) => {
        const up = r.updates[0];
        const title = (up?.after.title as string | undefined) ?? '';
        return [
          ...has(!!up, 'the instant event was not tidied'),
          ...has(/^training$/i.test(title.trim()), `tidied title is "${title}", not "Training"`),
          ...has(
            !!titled(
              r.items.filter((i) => i.type === 'task'),
              /report/i,
            ),
            'no task to send the report',
          ),
        ];
      },
    },
    {
      id: 'quiz',
      text: 'Quiz every Thursday 8pm-12pm',
      meant: 'A weekly Thursday event from 20:00 to midnight.',
      check: (r) => {
        const ev = r.items.find((i) => i.type === 'event');
        return [
          ...has(!!ev, 'no event'),
          ...has(!!ev?.rrule && /BYDAY=TH/.test(ev.rrule), 'does not repeat on Thursdays'),
          ...has(
            !!ev?.start_at && local(ev.start_at, r.timeZone).hm === '20:00',
            'does not start at 20:00',
          ),
          ...has(
            !!ev?.end_at && local(ev.end_at, r.timeZone).hm === '00:00',
            'does not end at midnight',
          ),
        ];
      },
    },
    {
      id: 'birthday',
      text: 'Niamh’s Birthday 11/11',
      meant: 'A yearly all-day event on 11 November.',
      check: (r) => {
        const ev = r.items.find((i) => i.type === 'event');
        return [
          ...has(!!ev, 'no event'),
          ...has(!!ev?.all_day, 'not all day'),
          ...has(!!ev?.rrule && /YEARLY/.test(ev.rrule), 'not yearly'),
          ...has(
            !!ev?.start_at && local(ev.start_at, r.timeZone).date.endsWith('-11-11'),
            'not on 11 November',
          ),
        ];
      },
    },
    {
      id: 'christmas-placeholder',
      text: 'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder',
      meant:
        'A weekly Friday placeholder event, a planning task with steps due before the first Friday, and specific questions (Phase 12).',
      check: (r) => {
        const ev = r.items.find((i) => i.type === 'event');
        const plan = r.items.find((i) => i.type === 'task' && i.data.planning === true);
        return [
          ...has(!!ev && /christmas sandwich/i.test(ev.title), 'no Christmas sandwiches event'),
          ...has(
            !ev?.start_at || local(ev.start_at, r.timeZone).day === 5,
            'first date is not a Friday',
          ),
          ...has(!!ev?.rrule && /BYDAY=FR/.test(ev.rrule), 'does not repeat on Fridays'),
          ...has(!!plan, 'no planning task with steps'),
          ...has(
            !!plan?.due_at && !!ev?.start_at && Date.parse(plan.due_at) < Date.parse(ev.start_at),
            'the planning task is not due before the first Friday',
          ),
          ...has(r.follow_ups.length >= 1, 'no question asked'),
          ...has(r.follow_ups.length <= 3, 'more than 3 questions'),
        ];
      },
    },
    {
      id: 'dentist-moved',
      text: 'dentist moved to Thursday 4pm',
      meant: 'The existing Dentist event moves to Thursday 16:00 (no new event).',
      check: (r) => {
        const a = r.actions.find((x) => x.kind === 'reschedule_item');
        const at = a?.after?.start_at as string | undefined;
        return [
          ...has(!!a && a.status === 'applied', 'the dentist was not moved'),
          ...has(a?.target_id === ids.dentist, 'moved the wrong item'),
          ...has(
            !!at && local(at, r.timeZone).day === 4 && local(at, r.timeZone).hm === '16:00',
            'not Thursday 16:00',
          ),
          ...has(!r.items.some((i) => i.type === 'event'), 'also made a new event'),
        ];
      },
    },
    {
      id: 'meeting-ambiguous',
      text: 'team meeting moved to Friday 10am',
      meant: 'Two team meetings exist: ask which one.',
      check: (r) => {
        const a = r.actions.find((x) => x.kind === 'reschedule_item');
        return [
          ...has(!!a, 'no move proposed'),
          ...has(a?.status === 'proposed', 'moved one without asking'),
          ...has(
            ((a?.payload.choices as string[] | undefined) ?? []).length === 2,
            'does not offer both meetings',
          ),
        ];
      },
    },
    {
      id: 'off-dec',
      text: 'off 22-24 Dec',
      meant: 'Annual leave booked 22–24 December.',
      check: (r) => {
        const a = r.actions.find((x) => x.kind === 'book_leave');
        return [
          ...has(!!a && a.status !== 'skipped', 'no leave booked'),
          ...has(String(a?.after?.start_date ?? '').endsWith('-12-22'), 'does not start 22 Dec'),
          ...has(String(a?.after?.end_date ?? '').endsWith('-12-24'), 'does not end 24 Dec'),
          ...has(!r.items.some((i) => i.type === 'event'), 'also made an event'),
        ];
      },
    },
    {
      id: 'entitlement',
      text: 'I get 23 days a year',
      meant: 'Annual leave entitlement set to 23.',
      check: (r) => {
        const a = r.actions.find((x) => x.kind === 'update_work_setting');
        return [
          ...has(a?.after?.entitlement === 23, 'entitlement not set to 23'),
          ...has(a?.status === 'applied', 'not applied'),
        ];
      },
    },
    {
      id: 'wfh-mondays',
      text: 'WFH Mondays',
      meant: 'Usual week: Monday is work from home.',
      check: (r) => {
        const a = r.actions.find((x) => x.kind === 'update_work_setting');
        const pattern = a?.after?.location_pattern as Record<string, string> | undefined;
        return has(pattern?.['1'] === 'wfh', 'Monday not set to WFH');
      },
    },
    {
      id: 'shopping',
      text: 'need milk and bin bags',
      meant: 'Two entries on the Shopping list.',
      check: (r) => {
        const entries = r.items.filter((i) => i.type === 'list_entry' && i.list_id);
        return has(entries.length === 2, `${entries.length} list entries on a known list, not 2`);
      },
    },
    {
      id: 'note-trevor',
      text: 'Notes from Monday: need to send the report to Trevor by Friday',
      note: true,
      meant: 'A task to send the report to Trevor, due Friday; the note itself unchanged.',
      check: (r) => {
        const task = titled(
          r.items.filter((i) => i.type === 'task'),
          /report/i,
        );
        return [
          ...has(!!task, 'no task from the note'),
          ...has(!!task?.due_at && local(task.due_at, r.timeZone).day === 5, 'not due on a Friday'),
        ];
      },
    },
    {
      id: 'vague',
      text: 'hmm the thing with the stuff',
      meant: 'Nothing clear: kept in the Workshop, not lost.',
      check: (r) =>
        has(
          r.workshop.length > 0 || r.items.some((i) => i.data.workshop === true),
          'not kept in the Workshop',
        ),
    },
  ];
  return { cases, candidates, ids };
}

/** A context where the owner has set an entitlement and has a Shopping list. */
export function evalActionContext(
  now: Date,
  candidates: Candidate[],
  today: string,
): ActionContext {
  return {
    userId: '00000000-0000-4000-8000-0000000000e1',
    now,
    today,
    timeZone: TZ,
    workRaw: { entitlement: 21 },
    bookings: [],
    candidates,
    items: new Map(
      candidates.map((c) => [
        c.id,
        {
          id: c.id,
          type: c.type,
          start_at: c.when,
          end_at: c.when ? new Date(Date.parse(c.when) + 3_600_000).toISOString() : null,
          all_day: false,
          due_at: null,
          data: {},
          updated_at: now.toISOString(),
        },
      ]),
    ),
  };
}
