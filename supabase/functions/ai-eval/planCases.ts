// The owner's timing cases (Task 13.9) for the real planner model. Each case is
// a digest in the shape plan_digest returns, built around a synthetic evening
// at 18:00 local, and a structural check on the model's answer (kinds and time
// windows, never wording). Nothing is written to the database.
import { addDays } from '../_shared/holidays/easter.ts';
import { localInstant } from '../_shared/plan/defaults.ts';
import type { PlanResultT } from '../_shared/schemas/plan.ts';
import type { RawPlanDigest } from '../plan-day/digest.ts';

export interface PlanCase {
  id: string;
  /** In the owner's words. */
  text: string;
  meant: string;
  settings: Record<string, unknown>;
  raw: RawPlanDigest;
  check: (r: PlanResultT, ids: Record<string, string>) => string[];
}

const TZ = 'Europe/Dublin';
const has = (cond: boolean, msg: string) => (cond ? [] : [msg]);

type RawItem = RawPlanDigest['items'][number];
function event(id: string, title: string, start: Date, over: Partial<RawItem> = {}): RawItem {
  return {
    id,
    type: 'event',
    title,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
    due_at: null,
    all_day: false,
    rrule: null,
    exdates: [],
    location: null,
    travel_minutes: null,
    plan: null,
    ...over,
  };
}

const nudgesFor = (r: PlanResultT, itemId: string) =>
  r.items.filter((i) => i.item_id === itemId).flatMap((i) => i.nudges);
/** "YYYY-MM-DD HH:MM" → [date, minutes]. */
const wall = (s: string): [string, number] => [
  s.slice(0, 10),
  Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)),
];

/** The evening the cases are planned from: 18:00 local on the date of `now`. */
export function planEvalNow(now: Date): { evening: string; at: Date } {
  const evening = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  return { evening, at: localInstant(evening, '18:00', TZ) };
}

export function planCases(now: Date): { cases: PlanCase[]; ids: Record<string, string> } {
  const { evening } = planEvalNow(now);
  const tomorrow = addDays(evening, 1);
  const at = (hhmm: string) => localInstant(tomorrow, hhmm, TZ);
  const ids = {
    training: 'b1300000-0000-4000-8000-000000000001',
    dentist: 'b1300000-0000-4000-8000-000000000002',
    form: 'b1300000-0000-4000-8000-000000000003',
    early: 'b1300000-0000-4000-8000-000000000004',
  };
  const raw = (items: RawItem[]): RawPlanDigest => ({
    date: evening,
    time_zone: TZ,
    items,
    linked: [],
    nudges: [],
    leave: [],
    work_days: [],
  });

  const cases: PlanCase[] = [
    {
      id: 'plan-training-bag',
      text: 'Training at 8 tomorrow morning',
      meant:
        'Pack the bag the evening before, a time to leave before 08:00, nothing useless at 07:30.',
      settings: {},
      raw: raw([
        event(ids.training, 'Training', at('08:00'), { travel_minutes: 20, location: 'Gym' }),
      ]),
      check: (r) => {
        const ns = nudgesFor(r, ids.training);
        const prepare = ns.filter((n) => n.kind === 'prepare');
        const leave = ns.find((n) => n.kind === 'leave');
        return [
          ...has(
            prepare.some((n) => wall(n.at)[0] === evening && wall(n.at)[1] >= 17 * 60),
            'no prepare the evening before',
          ),
          ...has(
            !prepare.some((n) => wall(n.at)[0] === tomorrow && wall(n.at)[1] > 8 * 60 - 45),
            'a prepare inside 45 minutes of the start',
          ),
          ...has(
            !!leave &&
              wall(leave.at)[0] === tomorrow &&
              wall(leave.at)[1] < 8 * 60 &&
              wall(leave.at)[1] >= 6 * 60,
            'no leave before the start',
          ),
        ];
      },
    },
    {
      id: 'plan-dentist',
      text: 'Dentist at 2 tomorrow',
      meant: 'Get ready on the morning of the day, and a time to leave before 14:00.',
      settings: {},
      raw: raw([event(ids.dentist, 'Dentist', at('14:00'), { location: 'Smile Clinic' })]),
      check: (r) => {
        const ns = nudgesFor(r, ids.dentist);
        const prepare = ns.find((n) => n.kind === 'prepare');
        const leave = ns.find((n) => n.kind === 'leave');
        return [
          ...has(
            !!prepare && wall(prepare.at)[0] === tomorrow && wall(prepare.at)[1] <= 14 * 60 - 45,
            'no prepare on the day with real lead time',
          ),
          ...has(
            !!leave &&
              wall(leave.at)[0] === tomorrow &&
              wall(leave.at)[1] < 14 * 60 &&
              wall(leave.at)[1] >= 12 * 60,
            'no leave before the start',
          ),
        ];
      },
    },
    {
      id: 'plan-friday-form',
      text: 'Need to send the form by Friday',
      meant: 'Due on a day with no time: no push; the digest carries it.',
      settings: {},
      raw: raw([
        {
          ...event(ids.form, 'Send the form', at('00:00')),
          type: 'task',
          start_at: null,
          end_at: null,
          due_at: `${tomorrow}T00:00:00.000Z`,
          all_day: true,
        },
      ]),
      check: (r) =>
        has(
          !nudgesFor(r, ids.form).some((n) => n.delivery === 'push'),
          'a push for a task with no time',
        ),
    },
    {
      id: 'plan-early-quiet',
      text: 'Flight check-in at 8, an hour to get there, and I keep quiet hours until 7',
      meant: 'The leave nudge goes out inside quiet hours; nothing else does.',
      settings: { notifications: { quiet_start: '22:00', quiet_end: '07:00' } },
      raw: raw([event(ids.early, 'Flight check-in', at('08:00'), { travel_minutes: 60 })]),
      check: (r) => {
        const ns = nudgesFor(r, ids.early);
        const leave = ns.find((n) => n.kind === 'leave');
        const quiet = (s: string) => {
          const m = wall(s)[1];
          return m >= 22 * 60 || m < 7 * 60;
        };
        return [
          ...has(
            !!leave &&
              wall(leave.at)[0] === tomorrow &&
              wall(leave.at)[1] <= 7 * 60 &&
              wall(leave.at)[1] >= 6 * 60,
            'no leave about an hour and ten minutes before',
          ),
          ...has(
            !ns.some(
              (n) => n.delivery === 'push' && n.kind !== 'leave' && n.kind !== 'do' && quiet(n.at),
            ),
            'another push inside quiet hours',
          ),
        ];
      },
    },
    {
      id: 'plan-empty-day',
      text: 'Nothing on tomorrow',
      meant: 'An empty plan and no nudges.',
      settings: {},
      raw: raw([]),
      check: (r) =>
        has(
          r.items.every((i) => i.nudges.length === 0),
          'nudges for a day with nothing on',
        ),
    },
  ];
  return { cases, ids };
}
