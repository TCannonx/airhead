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

export type SettingsRow = z.infer<typeof settingsSchema>;
export type DeviceRecord = z.infer<typeof deviceSchema>;
export type Capture = z.infer<typeof captureSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ItemType = Item['type'];
export type List = z.infer<typeof listSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type Correction = z.infer<typeof correctionSchema>;

/** Tables that sync with Supabase, in a stable order. */
export const SYNC_TABLES = [
  'settings',
  'devices',
  'captures',
  'items',
  'lists',
  'topics',
  'corrections',
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
} as const satisfies Record<SyncTable, z.ZodType>;

export interface RowTypes {
  settings: SettingsRow;
  devices: DeviceRecord;
  captures: Capture;
  items: Item;
  lists: List;
  topics: Topic;
  corrections: Correction;
}
