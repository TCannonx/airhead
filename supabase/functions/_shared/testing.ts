/**
 * Test helpers for the function handlers (handler.test.ts files). Not used in
 * production code. A fake caller knows two users and the service key; fake AI
 * and usage stores record what was asked of them.
 */
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import type { AIClient, UsageStore } from './ai.ts';
import type { Caller } from './caller.ts';

export const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const TOKEN_A = 'user-a-access-token';
export const TOKEN_B = 'user-b-access-token';
export const SERVICE = 'service-key-for-tests-only';

/** Users A and B by their access tokens; SERVICE is the service key. */
export const fakeCaller: Caller = {
  userId: (token) =>
    Promise.resolve(token === TOKEN_A ? USER_A : token === TOKEN_B ? USER_B : null),
  isService: (token) => Promise.resolve(token === SERVICE),
};

const URL_ = 'http://localhost/functions/v1/x';

/** A POST with a JSON body (or raw text) and an optional bearer token. */
export function post(body: unknown, token?: string, raw?: string): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? JSON.stringify(body),
  });
}

/** A POST whose body is not JSON. */
export const badJson = (token?: string) => post(null, token, '{not json');

export const request = (method: string, token?: string) =>
  new Request(URL_, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

/** The browser's CORS preflight is answered with the shared CORS headers. */
export async function assertPreflight(res: Response, methods = 'POST, OPTIONS') {
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(
    res.headers.get('Access-Control-Allow-Headers'),
    'authorization, apikey, content-type, x-client-info',
  );
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), methods);
  await res.body?.cancel();
}

/** Status and error_code of a JSON reply (CORS header checked too). */
export async function outcome(res: Response): Promise<[number, string | null]> {
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  const body = (await res.json()) as { error_code?: string | null };
  return [res.status, body.error_code ?? null];
}

/** An AI client that must not be called (records any call). */
export function noAI() {
  const calls: unknown[] = [];
  const ai = {
    messages: {
      parse: (p: unknown) => {
        calls.push(p);
        return Promise.reject(new Error('the AI should not be called'));
      },
      create: (p: unknown) => {
        calls.push(p);
        return Promise.reject(new Error('the AI should not be called'));
      },
    },
  } as unknown as AIClient;
  return { ai, calls };
}

/** An AI client that answers every structured call with `output`. */
export function fakeAI(output: unknown) {
  const calls: Record<string, unknown>[] = [];
  const ai = {
    messages: {
      parse: (p: Record<string, unknown>) => {
        calls.push(p);
        return Promise.resolve({
          parsed_output: output,
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 10,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        });
      },
    },
  } as unknown as AIClient;
  return { ai, calls };
}

export const usage: UsageStore = {
  price: (model) =>
    Promise.resolve({
      model,
      input_per_mtok: 1,
      output_per_mtok: 5,
      cache_read_per_mtok: 0.1,
      cache_write_per_mtok: 1.25,
      eur_rate: 0.86,
    }),
  monthlyCapEur: () => Promise.resolve(null),
  monthToDateEur: () => Promise.resolve(0),
  record: () => Promise.resolve(),
};
