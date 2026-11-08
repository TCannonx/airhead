import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';

/**
 * The Anthropic client every function uses. ANTHROPIC_BASE_URL is set only in
 * CI's end-to-end job, where it points at tests/mock-ai (a stand-in that
 * answers with saved outputs and rejects requests the real API would reject),
 * so the whole app runs end to end without the paid API.
 */
export function anthropicClient(apiKey: string): Anthropic {
  const baseURL = Deno.env.get('ANTHROPIC_BASE_URL');
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
}
