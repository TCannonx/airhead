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
  /** The words of the capture this item comes from (Task 12.1; shown on the receipt). */
  quote: z.string(),
  /**
   * Up to 5 checklist steps for a planning task (Task 12.1): a note that implies
   * more work ("still need to plan") gets a task with these. Empty otherwise.
   */
  steps: z.array(z.string()),
});

const ACTION_KINDS = [
  'set_leave_remaining',
  'set_leave_used',
  'book_leave',
  'update_work_setting',
  'set_reminder',
  'reschedule_item',
  'add_prep_rule',
] as const;

/**
 * A change to the person's records that a capture asks for (Phase 10), as the
 * planner sees it. The planner checks every field in code; the model only
 * suggests. Not sent to the API as a schema (see ActionWire).
 */
export const SortAction = z.object({
  kind: z.enum(ACTION_KINDS),
  /** The words of the capture this action comes from. */
  quote: z.string(),
  confidence: z.number(),
  days: z.number().nullable(),
  /** YYYY-MM-DD */
  as_of: z.string().nullable(),
  leave_type: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  start_half: z.boolean().nullable(),
  end_half: z.boolean().nullable(),
  leave_status: z.enum(['planned', 'requested', 'approved', 'taken']).nullable(),
  setting: z
    .enum(['entitlement', 'leave_year_start', 'working_days', 'location_pattern', 'carry_over_max'])
    .nullable(),
  /** JSON text of the new setting value, e.g. 23, "01-01" (quoted), [1,2,3,4]. */
  value: z.string().nullable(),
  /** Index into this capture's own items (a reminder on something new). */
  target_item_index: z.number().int().nullable(),
  /** An id from existing_items. */
  target_id: z.string().nullable(),
  /** Other existing_items ids that could equally be meant. */
  other_matches: z.array(z.string()),
  remind_at: z.string().nullable(),
  offset_minutes: z.number().int().nullable(),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  all_day: z.boolean().nullable(),
  due_at: z.string().nullable(),
  /** add_prep_rule: words that pick out the events, what to remind, and when. */
  match: z.array(z.string()).nullable(),
  reminder: z.string().nullable(),
  minutes_before: z.number().int().nullable(),
});

/**
 * An action as the model returns it: the kind-specific fields travel as JSON
 * text in `details`. Spelling them out as nullable schema fields pushed the
 * sorting schema past the API's limit of 16 union-typed parameters, and every
 * sorting request was rejected (2026-11-08). `readAction` turns this into a
 * SortAction, keeping only valid fields.
 */
export const ActionWire = z.object({
  kind: z.enum(ACTION_KINDS),
  quote: z.string(),
  confidence: z.number(),
  /** A JSON object with this action's fields, e.g. {"days": 9.5, "as_of": "2026-11-08"}. */
  details: z.string(),
});
export type ActionWireT = z.infer<typeof ActionWire>;

const DETAIL_FIELDS = SortAction.omit({ kind: true, quote: true, confidence: true }).shape;

/** Reads an action's details leniently: each field is kept only if valid, else null. */
export function readAction(w: ActionWireT): SortActionT {
  let d: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(w.details);
    if (v && typeof v === 'object' && !Array.isArray(v)) d = v as Record<string, unknown>;
  } catch {
    // Unreadable details: every field null; the planner then proposes or drops it.
  }
  // `value` is JSON text; accept a plain JSON value too.
  if (d.value !== undefined && d.value !== null && typeof d.value !== 'string')
    d = { ...d, value: JSON.stringify(d.value) };
  const out: Record<string, unknown> = { kind: w.kind, quote: w.quote, confidence: w.confidence };
  for (const [key, field] of Object.entries(DETAIL_FIELDS)) {
    const parsed = (field as z.ZodType).safeParse(d[key] ?? (key === 'other_matches' ? [] : null));
    out[key] = parsed.success ? parsed.data : key === 'other_matches' ? [] : null;
  }
  return out as SortActionT;
}

/**
 * A question Airhead asks about a note that implies more work (Task 12.1). Not
 * nullable anywhere, so the schema stays within the union-parameter limit.
 */
export const FollowUp = z.object({
  /** Specific to the note, e.g. "Who are the sandwiches for?". */
  question: z.string(),
  /** 0 to 4 short quick answers, e.g. ["Family", "Work", "Friends"]. */
  options: z.array(z.string()),
  /** Index of this capture's own item the question is about, or -1 for none. */
  about_item: z.number().int(),
});
export type FollowUpT = z.infer<typeof FollowUp>;

/** Results for notes (Task 11.0) carry capture_id "note:<item id>"; no extra schema field. */
export const NOTE_PREFIX = 'note:';

export const SortResult = z.object({
  results: z.array(
    z.object({
      /** A capture's id, or "note:<id>" for a <note> block. */
      capture_id: z.string(),
      items: z.array(SortedItem),
      /** Changes to records the capture asks for; usually none (Phase 10). */
      actions: z.array(ActionWire),
      /**
       * Words no item or action covers (Task 11.2), or null. Airhead keeps them as
       * a Workshop note, so nothing is dropped silently.
       */
      leftover: z.string().nullable(),
      /** Up to 3 questions when the capture implies more work (Task 12.1); usually none. */
      follow_ups: z.array(FollowUp),
      /** Lasting facts about the person, only from what they typed. */
      proposed_facts: z.array(
        z.object({ text: z.string(), category: z.enum(['everyday', 'person', 'personal']) }),
      ),
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
  /** One or two sentences on what this batch noticed (Task 11.0), or null. */
  digest: z.string().nullable(),
});

export type SortedItemT = z.infer<typeof SortedItem>;
export type SortResultT = z.infer<typeof SortResult>;
type SortResultEntry = SortResultT['results'][number];
/** An item as the planner accepts it: quote and steps optional (older saved answers lack them). */
export type SortAnswerItem = Omit<SortedItemT, 'quote' | 'steps'> & {
  quote?: string;
  steps?: string[];
};
/**
 * What the planner accepts: a sorting answer, digest, leftover, follow_ups and
 * the items' quote and steps optional (older saved answers lack them).
 */
export type SortAnswer = {
  results: (Omit<SortResultEntry, 'leftover' | 'follow_ups' | 'items'> & {
    items: SortAnswerItem[];
    leftover?: string | null;
    follow_ups?: FollowUpT[];
  })[];
  digest?: string | null;
};
export type SortActionT = z.infer<typeof SortAction>;
