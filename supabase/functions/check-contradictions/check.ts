import { z } from 'npm:zod@4.6.7';

export const ContradictionsResult = z.object({
  conflicts: z.array(
    z.object({
      fact_ids: z.array(z.string()),
      explanation: z.string(),
      merged_text: z.string().nullable(),
    }),
  ),
});
export type ContradictionsResultT = z.infer<typeof ContradictionsResult>;

export interface Conflict {
  fact_ids: [string, string];
  explanation: string;
  merged_text: string | null;
}

/** Keeps only pairs of two different, real facts; each pair once. */
export function validConflicts(result: ContradictionsResultT, factIds: string[]): Conflict[] {
  const known = new Set(factIds);
  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (const c of result.conflicts) {
    const [a, b] = c.fact_ids;
    if (c.fact_ids.length !== 2 || !a || !b || a === b || !known.has(a) || !known.has(b)) continue;
    const key = [a, b].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      fact_ids: [a, b],
      explanation: c.explanation.trim(),
      merged_text: c.merged_text?.trim() || null,
    });
  }
  return out;
}
