import { z } from 'npm:zod@4.6.7';

/**
 * What the sorting model returns for a batch of captures. Optional values are
 * `nullable` (always present) so the JSON schema stays strict-friendly.
 */
export const SortedItem = z.object({
  type: z.enum(['task', 'event', 'reading', 'idea', 'meeting', 'note', 'list_entry']),
  title: z.string(),
  body: z.string().nullable(),
  /** ISO 8601 with offset, e.g. 2026-11-10T15:00:00+00:00 */
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  all_day: z.boolean(),
  due_at: z.string().nullable(),
  rrule: z.string().nullable(),
  list_name: z.string().nullable(),
  topics: z.array(z.string()),
  confidence: z.number(),
  suggest_workshop: z.boolean(),
  related_idea_title: z.string().nullable(),
});

export const SortResult = z.object({
  results: z.array(
    z.object({
      capture_id: z.string(),
      items: z.array(SortedItem),
      /** Only for saved web pages; null otherwise. */
      link_summary: z
        .object({
          summary: z.string(),
          key_points: z.array(z.string()),
          topics: z.array(z.string()),
        })
        .nullable(),
    }),
  ),
});

export type SortedItemT = z.infer<typeof SortedItem>;
export type SortResultT = z.infer<typeof SortResult>;
