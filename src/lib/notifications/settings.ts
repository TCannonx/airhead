import { z } from 'zod';
import type { SettingsRow } from '../schemas/records';

/**
 * Notification settings (Task 4.15), kept in settings.data.notifications. The
 * same shape and defaults as the server's scheduler-tick/notif.ts (keep in step);
 * the reminder trigger reads event_reminder_minutes too.
 */
export const NUDGE_TYPES = [
  'event_reminder',
  'task_due',
  'check_time',
  'evening_review',
  'checklist',
  'leave_runout',
  'slip',
  'morning_brief',
  'weekly_review',
] as const;
export type NudgeType = (typeof NUDGE_TYPES)[number];

export const NUDGE_LABELS: Record<NudgeType, string> = {
  event_reminder: 'Event reminders',
  task_due: 'Task due reminders',
  check_time: '“Time confirmed yet?” checks for imported events',
  evening_review: 'Evening review',
  checklist: 'Location checklist the evening before',
  leave_runout: 'Leave running out',
  slip: 'Tasks that keep slipping',
  morning_brief: 'Morning brief and round-up',
  weekly_review: 'Weekly review ready',
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const notifSettingsSchema = z.object({
  types: z
    .object(
      Object.fromEntries(NUDGE_TYPES.map((t) => [t, z.boolean().default(true)])) as Record<
        NudgeType,
        z.ZodDefault<z.ZodBoolean>
      >,
    )
    .default(Object.fromEntries(NUDGE_TYPES.map((t) => [t, true])) as Record<NudgeType, boolean>),
  quiet_start: hhmm.default('22:00'),
  quiet_end: hhmm.default('07:30'),
  quiet_allows_events: z.boolean().default(true),
  daily_cap: z.number().int().min(1).max(50).default(8),
  evening_review_time: hhmm.default('21:00'),
  checklist_time: hhmm.default('20:00'),
  morning_time: hhmm.default('08:00'),
  brief_time: hhmm.default('07:30'),
  /** Weekly review: 0 = Monday … 6 = Sunday (Task 8.3). */
  review_day: z.number().int().min(0).max(6).default(6),
  review_time: hhmm.default('19:00'),
  event_reminder_minutes: z.number().int().min(0).max(1440).default(30),
});
export type NotifSettings = z.infer<typeof notifSettingsSchema>;

export const DEFAULT_NOTIF: NotifSettings = notifSettingsSchema.parse({});

/** Reads settings.data.notifications; each invalid field falls back to its default. */
export function readNotifSettings(settings: SettingsRow | undefined | null): NotifSettings {
  const raw = settings?.data?.notifications;
  if (!raw || typeof raw !== 'object') return DEFAULT_NOTIF;
  const whole = notifSettingsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const out: Record<string, unknown> = { ...DEFAULT_NOTIF, types: { ...DEFAULT_NOTIF.types } };
  const shape = notifSettingsSchema.shape;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in shape)) continue;
    if (key === 'types' && value && typeof value === 'object') {
      for (const t of NUDGE_TYPES) {
        const v = (value as Record<string, unknown>)[t];
        if (typeof v === 'boolean') (out.types as Record<string, boolean>)[t] = v;
      }
      continue;
    }
    const field = shape[key as keyof typeof shape].safeParse(value);
    if (field.success) out[key] = field.data;
  }
  return out as NotifSettings;
}
