import { z } from 'npm:zod@4.6.7';

/** One day's summary (Task 14.1). Trimmed to 120 words in code. */
export const DayDigestResult = z.object({ digest: z.string() });
export type DayDigestResultT = z.infer<typeof DayDigestResult>;

/** One month's summary from its weekly digests (Task 14.2). Trimmed to 150 words in code. */
export const MonthDigestResult = z.object({ digest: z.string() });
export type MonthDigestResultT = z.infer<typeof MonthDigestResult>;
