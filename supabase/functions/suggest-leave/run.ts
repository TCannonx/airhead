import { z } from 'npm:zod@4.6.7';
import { callAI, type AIClient, type UsageStore } from '../_shared/ai.ts';
import { buildLeaveMessage, LEAVE_SYSTEM } from '../_shared/prompts/leave.v1.ts';

/**
 * suggest-leave (Task 8.8): the device sends the bridge candidates it found
 * (from its own data) plus a little context; one small-tier call picks two
 * or three and says why. Picks are limited to the candidates sent.
 */
export const MAX_CANDIDATES = 10;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const LeaveRequest = z.object({
  today: z.string().regex(DATE),
  candidates: z
    .array(
      z.object({
        leave: z.array(z.string().regex(DATE)).min(1).max(5),
        start: z.string().regex(DATE),
        end: z.string().regex(DATE),
        days_off: z.number().int().min(1).max(30),
      }),
    )
    .min(1)
    .max(MAX_CANDIDATES),
  context: z.object({
    occasions: z.array(z.object({ date: z.string(), title: z.string().max(120) })).max(20),
    days_since_break: z.number().nullable(),
    busy_weeks: z.array(z.object({ week: z.string(), events: z.number() })).max(20),
  }),
});
export type LeaveRequestT = z.infer<typeof LeaveRequest>;

export const LeaveResult = z.object({
  picks: z.array(z.object({ n: z.number().int(), why: z.string() })),
});

export type LeaveOutcome =
  | {
      ok: true;
      error_code: null;
      message: string;
      picks: { index: number; why: string }[];
    }
  | { ok: false; error_code: string; message: string };

export async function runSuggestLeave(
  body: unknown,
  userId: string,
  deps: { ai: AIClient; store: UsageStore },
): Promise<LeaveOutcome> {
  const parsed = LeaveRequest.safeParse(body);
  if (!parsed.success)
    return { ok: false, error_code: 'bad_request', message: 'Nothing to suggest from.' };
  const req = parsed.data;
  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'suggest_leave',
      tier: 'small',
      system: LEAVE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildLeaveMessage({
            today: req.today,
            candidates: req.candidates.map((c, i) => ({ n: i + 1, ...c })),
            context: req.context,
          }),
        },
      ],
      schema: LeaveResult,
      maxTokens: 1000,
      background: false,
    },
  );
  if (!result.ok) return { ok: false, error_code: result.error_code, message: result.message };
  const seen = new Set<number>();
  const picks: { index: number; why: string }[] = [];
  for (const p of result.data.picks) {
    const index = p.n - 1;
    if (index < 0 || index >= req.candidates.length || seen.has(index)) continue;
    seen.add(index);
    picks.push({ index, why: p.why.trim().slice(0, 200) });
    if (picks.length === 3) break;
  }
  return { ok: true, error_code: null, message: 'Here are a few ideas.', picks };
}
