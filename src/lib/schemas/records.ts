import { z } from 'zod';

/**
 * Zod schemas for every synced table. Shared by the local database, the sync
 * payloads and (later) the Edge Functions. Timestamps are ISO strings exactly
 * as Postgres/PostgREST return them; date-only values are YYYY-MM-DD.
 */
const ts = z.iso.datetime({ offset: true });
const date = z.iso.date();
const id = z.guid();

export const syncColumns = {
  id,
  user_id: id,
  created_at: ts,
  updated_at: ts,
  /** Set by the server; null until the row has been pushed once. */
  server_updated_at: ts.nullable(),
  deleted_at: ts.nullable(),
};

export const settingsSchema = z.object({
  ...syncColumns,
  data: z.record(z.string(), z.unknown()),
});

export const deviceSchema = z.object({
  ...syncColumns,
  name: z.string(),
  platform: z.string(),
  push_subscription: z.unknown().nullable(),
  receives_notifications: z.boolean(),
  last_sync_at: ts.nullable(),
});

export const CAPTURE_KINDS = ['text', 'link', 'ink', 'image', 'import'] as const;
export const CAPTURE_SOURCES = ['app', 'shortcut', 'bookmarklet'] as const;
export const CAPTURE_STATUSES = ['unsorted', 'sorted', 'needs_review', 'failed'] as const;

export const captureSchema = z.object({
  ...syncColumns,
  kind: z.enum(CAPTURE_KINDS),
  text: z.string().nullable(),
  url: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  source: z.enum(CAPTURE_SOURCES),
  status: z.enum(CAPTURE_STATUSES),
  captured_at: ts,
  sorted_at: ts.nullable(),
});

export const ITEM_TYPES = [
  'task',
  'event',
  'reading',
  'idea',
  'meeting',
  'note',
  'list_entry',
] as const;
export const ITEM_STATUSES = ['open', 'suggested', 'done', 'dropped'] as const;

export const itemSchema = z.object({
  ...syncColumns,
  capture_id: id.nullable(),
  type: z.enum(ITEM_TYPES),
  title: z.string(),
  body: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  status: z.enum(ITEM_STATUSES),
  due_at: ts.nullable(),
  start_at: ts.nullable(),
  end_at: ts.nullable(),
  all_day: z.boolean(),
  rrule: z.string().nullable(),
  calendar: z.enum(['personal', 'us']).nullable(),
  series_id: id.nullable(),
  list_id: id.nullable(),
  topic_ids: z.array(id),
  confidence: z.number().min(0).max(1).nullable(),
  top3_date: date.nullable(),
  carry_count: z.number().int().min(0),
  completed_at: ts.nullable(),
});

export const listSchema = z.object({
  ...syncColumns,
  name: z.string().min(1),
  sort_order: z.number().int(),
});

export const topicSchema = z.object({
  ...syncColumns,
  name: z.string().min(1),
});

export const correctionSchema = z.object({
  ...syncColumns,
  capture_id: id.nullable(),
  from_value: z.record(z.string(), z.unknown()),
  to_value: z.record(z.string(), z.unknown()),
});

export const memoryFactSchema = z.object({
  ...syncColumns,
  text: z.string().min(1),
  category: z.enum(['everyday', 'person', 'personal']),
  status: z.enum(['active', 'pending_approval', 'archived']),
  source_capture_id: id.nullable(),
  last_used_at: ts.nullable(),
});

export const learnedRuleSchema = z.object({
  ...syncColumns,
  pattern: z.string().min(1),
  match_kind: z.enum(['prefix', 'keyword']),
  result: z.object({
    type: z.enum(ITEM_TYPES),
    list_id: id.nullish(),
    calendar: z.enum(['personal', 'us']).nullish(),
  }),
  hits: z.number().int().min(0),
  enabled: z.boolean(),
});

export const CALENDARS = ['personal', 'us'] as const;

export const seriesSchema = z.object({
  ...syncColumns,
  name: z.string().min(1),
  calendar: z.enum(CALENDARS),
  colour: z.string().nullable(),
  source_kind: z.enum(['manual', 'import']),
  source_path: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});

export const FEED_KINDS = ['us_out', 'me_out', 'linked_in'] as const;

export const feedSchema = z.object({
  ...syncColumns,
  kind: z.enum(FEED_KINDS),
  name: z.string(),
  colour: z.string().nullable(),
  /** Hex SHA-256 of an outgoing feed's token; the token itself is never stored. */
  token_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  url: z.string().nullable(),
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  last_fetched_at: ts.nullable(),
  last_error: z.string().nullable(),
});

/** One occurrence of a linked calendar's event. Written by the server only. */
export const externalEventSchema = z.object({
  ...syncColumns,
  feed_id: id,
  occurrence_key: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  start_at: ts,
  end_at: ts.nullable(),
  all_day: z.boolean(),
});

export const WORK_LOCATIONS = ['wfh', 'office', 'client', 'travel', 'off'] as const;

export const workDaySchema = z.object({
  ...syncColumns,
  date,
  location: z.enum(WORK_LOCATIONS),
  note: z.string().nullable(),
});

export const LEAVE_STATUSES = ['planned', 'requested', 'approved', 'taken'] as const;

export const leaveBookingSchema = z.object({
  ...syncColumns,
  start_date: date,
  end_date: date,
  start_half: z.boolean(),
  end_half: z.boolean(),
  leave_type: z.string().min(1),
  status: z.enum(LEAVE_STATUSES),
  share_us: z.boolean(),
  /** PostgREST returns numeric as a number (or a string for very large values). */
  days: z.coerce.number().nullable(),
  note: z.string().nullable(),
  capture_id: id.nullable(),
});

export type SettingsRow = z.infer<typeof settingsSchema>;
export type DeviceRecord = z.infer<typeof deviceSchema>;
export type Capture = z.infer<typeof captureSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ItemType = Item['type'];
export type List = z.infer<typeof listSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type Correction = z.infer<typeof correctionSchema>;
export type MemoryFact = z.infer<typeof memoryFactSchema>;
export type LearnedRule = z.infer<typeof learnedRuleSchema>;
export type Series = z.infer<typeof seriesSchema>;
export type Feed = z.infer<typeof feedSchema>;
export type ExternalEvent = z.infer<typeof externalEventSchema>;
export type WorkDay = z.infer<typeof workDaySchema>;
export type WorkLocation = WorkDay['location'];
export type LeaveBooking = z.infer<typeof leaveBookingSchema>;

/** Tables that sync with Supabase, in a stable order. */
export const SYNC_TABLES = [
  'settings',
  'devices',
  'captures',
  'items',
  'lists',
  'topics',
  'corrections',
  'memory_facts',
  'learned_rules',
  'series',
  'feeds',
  'external_events',
  'work_days',
  'leave_bookings',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export const schemas = {
  settings: settingsSchema,
  devices: deviceSchema,
  captures: captureSchema,
  items: itemSchema,
  lists: listSchema,
  topics: topicSchema,
  corrections: correctionSchema,
  memory_facts: memoryFactSchema,
  learned_rules: learnedRuleSchema,
  series: seriesSchema,
  feeds: feedSchema,
  external_events: externalEventSchema,
  work_days: workDaySchema,
  leave_bookings: leaveBookingSchema,
} as const satisfies Record<SyncTable, z.ZodType>;

export interface RowTypes {
  settings: SettingsRow;
  devices: DeviceRecord;
  captures: Capture;
  items: Item;
  lists: List;
  topics: Topic;
  corrections: Correction;
  memory_facts: MemoryFact;
  learned_rules: LearnedRule;
  series: Series;
  feeds: Feed;
  external_events: ExternalEvent;
  work_days: WorkDay;
  leave_bookings: LeaveBooking;
}
