import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.6.0/helpers/zod';
import type { z } from 'npm:zod@4.6.7';
import { costEur, type Price } from './prices.ts';

/**
 * The ONLY code that talks to the Anthropic API.
 *
 * - tier → model from config (small = sorting batches, large = briefs/reviews)
 * - structured output via `output_config.format` (JSON schema from Zod),
 *   validated again with Zod; one retry on invalid output
 * - the fixed system prompt is sent as a cached block (prompt caching)
 * - checks the monthly cap first; when reached, nothing is sent
 * - writes one ai_usage row per attempt, successful or not
 */

export type Tier = 'small' | 'large';

export const MODELS: Record<Tier, string> = {
  small: 'claude-haiku-5-5',
  large: 'claude-sonnet-5-5',
};

export interface UsageRow {
  user_id: string;
  task: string;
  tier: Tier;
  model: string;
  attempt: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_eur: number;
  ok: boolean;
  error_code: string | null;
}

/** Where the gateway reads prices/caps and writes usage (Supabase in functions, fakes in tests). */
export interface UsageStore {
  price(userId: string, model: string): Promise<Price>;
  /** Monthly cap in euros, or null for no cap. */
  monthlyCapEur(userId: string): Promise<number | null>;
  monthToDateEur(userId: string): Promise<number>;
  record(row: UsageRow): Promise<void>;
}

/** The slice of the SDK client the gateway uses (the real client satisfies it). */
export type AIClient = Pick<Anthropic, 'messages'>;

export interface CallAIRequest<T> {
  userId: string;
  task: string;
  tier: Tier;
  /** Fixed instructions (cached). Put anything per-request in `messages`. */
  system: string | string[];
  messages: Anthropic.MessageParam[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  /** Background tasks stay queued at the cap; on-demand ones show the cap message. */
  background: boolean;
}

export type AIErrorCode = 'cap_reached' | 'invalid_output' | 'api_error' | 'refused';

export type CallAIResult<T> =
  { ok: true; data: T; costEur: number } | { ok: false; error_code: AIErrorCode; message: string };

const MESSAGES: Record<AIErrorCode, string> = {
  cap_reached: 'This month’s AI limit has been reached. Raise it in Insights → AI usage.',
  invalid_output: 'The AI answer could not be read. It will be tried again later.',
  api_error: 'The AI service is not available right now. It will be tried again later.',
  refused: 'The AI declined this request.',
};

const fail = <T>(code: AIErrorCode): CallAIResult<T> => ({
  ok: false,
  error_code: code,
  message: MESSAGES[code],
});

/** Beta header for `fallbacks: "default"` (server-side refusal fallback). */
export const LARGE_TIER_BETA = 'server-side-fallback-2026-07-01';

export async function callAI<T>(
  deps: { client: AIClient; store: UsageStore; models?: Record<Tier, string> },
  req: CallAIRequest<T>,
): Promise<CallAIResult<T>> {
  const model = (deps.models ?? MODELS)[req.tier];
  const base = {
    user_id: req.userId,
    task: req.task,
    tier: req.tier,
    model,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_eur: 0,
  };

  const cap = await deps.store.monthlyCapEur(req.userId);
  if (cap !== null && (await deps.store.monthToDateEur(req.userId)) >= cap) {
    await deps.store.record({ ...base, attempt: 1, ok: false, error_code: 'cap_reached' });
    return fail('cap_reached');
  }

  const price = await deps.store.price(req.userId, model);

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Awaited<ReturnType<AIClient['messages']['parse']>>;
    try {
      // Large tier: if the model declines, the API re-runs the request on its
      // recommended fallback model in the same call (server-side fallback, beta).
      // Haiku has no server-side fallback, so small-tier calls don't ask for one.
      const large = req.tier === 'large';
      response = await deps.client.messages.parse(
        {
          ...(large ? ({ fallbacks: 'default' } as Record<string, unknown>) : {}),
          model,
          max_tokens: req.maxTokens ?? 8000,
          // Each block is its own cache breakpoint (fixed instructions, then the
          // slower-changing memory profile); at most 4 are allowed.
          system: (Array.isArray(req.system) ? req.system : [req.system])
            .filter((text) => text.trim())
            .slice(0, 4)
            .map((text) => ({
              type: 'text' as const,
              text,
              cache_control: { type: 'ephemeral' as const },
            })),
          messages: req.messages,
          output_config: {
            format: zodOutputFormat(req.schema),
            ...(req.effort ? { effort: req.effort } : {}),
          },
        },
        large ? { headers: { 'anthropic-beta': LARGE_TIER_BETA } } : undefined,
      );
    } catch (error) {
      // HTTP/API failures carry a status; anything else is the answer failing to parse.
      const isApi = typeof (error as { status?: unknown })?.status === 'number';
      await deps.store.record({
        ...base,
        attempt,
        ok: false,
        error_code: isApi ? 'api_error' : 'invalid_output',
      });
      if (isApi) return fail('api_error');
      continue;
    }

    const usage = response.usage;
    const row = {
      ...base,
      attempt,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_eur: costEur(usage, price),
    };

    if (response.stop_reason === 'refusal') {
      await deps.store.record({ ...row, ok: false, error_code: 'refused' });
      return fail('refused');
    }

    const parsed = req.schema.safeParse(response.parsed_output);
    if (parsed.success) {
      await deps.store.record({ ...row, ok: true, error_code: null });
      return { ok: true, data: parsed.data, costEur: row.cost_eur };
    }
    await deps.store.record({ ...row, ok: false, error_code: 'invalid_output' });
  }
  return fail('invalid_output');
}
