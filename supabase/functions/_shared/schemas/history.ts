import { z } from 'npm:zod@4.6.7';

/** One day's summary (Task 14.1). Trimmed to 120 words in code. */
export const DayDigestResult = z.object({ digest: z.string() });
export type DayDigestResultT = z.infer<typeof DayDigestResult>;
