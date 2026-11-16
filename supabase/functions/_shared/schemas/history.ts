import { z } from 'npm:zod@4.6.7';

/** One day's summary (Task 14.1). Trimmed to 120 words in code. */
export const DayDigestResult = z.object({ digest: z.string() });
export type DayDigestResultT = z.infer<typeof DayDigestResult>;

/** One month's summary from its weekly digests (Task 14.2). Trimmed to 150 words in code. */
export const MonthDigestResult = z.object({ digest: z.string() });
export type MonthDigestResultT = z.infer<typeof MonthDigestResult>;

/** A page's running summary and dated facts (Task 14.5). Trimmed in code. */
export const PageSummaryResult = z.object({
  summary: z.string(),
  facts: z.array(z.object({ date: z.string(), text: z.string() })),
});
export type PageSummaryResultT = z.infer<typeof PageSummaryResult>;

/** What a small call adds to a saved link (Task 16.2). Lists are trimmed in code. */
export const LinkEnrichment = z.object({
  kind: z.enum(['article', 'video', 'paper', 'thread', 'product', 'other']),
  summary: z.string(),
  key_points: z.array(z.string()),
  why_saved: z.string(),
  topics: z.array(z.string()),
  mentions: z.array(z.object({ kind: z.enum(['person', 'club', 'tool']), name: z.string() })),
});
export type LinkEnrichmentT = z.infer<typeof LinkEnrichment>;

/** A topic page's collation (Task 16.5). Trimmed in code. */
export const TopicResult = z.object({
  summary: z.string(),
  notes: z.array(z.object({ item_id: z.string(), note: z.string() })),
  overlaps: z.array(z.string()),
  open_questions: z.array(z.string()),
  next_step: z.string(),
});
export type TopicResultT = z.infer<typeof TopicResult>;
