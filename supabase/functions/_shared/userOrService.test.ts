// Handler tests for the three functions that the app calls with { mode } and
// the scheduler calls with the service key and { user_id }.
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { handleBrief } from '../morning-brief/handler.ts';
import { handleScout } from '../scout/handler.ts';
import { handleReview } from '../weekly-review/handler.ts';
import {
  assertPreflight,
  badJson,
  fakeCaller,
  outcome,
  post,
  request,
  SERVICE,
  TOKEN_A,
  USER_A,
  USER_B,
} from './testing.ts';

type Run = [string, boolean];
const cases: {
  name: string;
  mode: string;
  handle: (req: Request, runs: Run[]) => Promise<Response>;
}[] = [
  {
    name: 'morning-brief',
    mode: 'regenerate',
    handle: (req, runs) =>
      handleBrief(req, {
        caller: fakeCaller,
        brief: (userId, roundUp) => {
          runs.push([userId, roundUp]);
          return Promise.resolve({ status: 'skipped', reason: 'quiet_day' });
        },
      }),
  },
  {
    name: 'weekly-review',
    mode: 'run',
    handle: (req, runs) =>
      handleReview(req, {
        caller: fakeCaller,
        review: (userId, notify) => {
          runs.push([userId, notify]);
          return Promise.resolve({ status: 'ok', week_start: '2026-11-02' });
        },
      }),
  },
  {
    name: 'scout',
    mode: 'run',
    handle: (req, runs) =>
      handleScout(req, {
        caller: fakeCaller,
        scout: (userId, trigger) => {
          runs.push([userId, trigger === 'weekly']);
          return Promise.resolve({ cards: 0, queries: [], searches: 0 });
        },
      }),
  },
];

for (const c of cases) {
  Deno.test(`${c.name}: preflight, method, missing token, bad JSON, unknown mode`, async () => {
    const runs: Run[] = [];
    await assertPreflight(await c.handle(request('OPTIONS'), runs));
    assertEquals(await outcome(await c.handle(request('GET', TOKEN_A), runs)), [
      405,
      'method_not_allowed',
    ]);
    assertEquals(await outcome(await c.handle(post({ mode: c.mode }), runs)), [
      401,
      'unauthorized',
    ]);
    assertEquals(await outcome(await c.handle(badJson(TOKEN_A), runs)), [400, 'bad_request']);
    assertEquals(await outcome(await c.handle(post({ mode: 'other' }, TOKEN_A), runs)), [
      400,
      'bad_request',
    ]);
    // The service key without a user is not a user either.
    assertEquals(await outcome(await c.handle(post({ mode: c.mode }, SERVICE), runs)), [
      401,
      'unauthorized',
    ]);
    assertEquals(runs, []);
  });

  Deno.test(
    `${c.name}: a user runs it for themselves only; the service for the named user`,
    async () => {
      const runs: Run[] = [];
      assertEquals(
        await outcome(await c.handle(post({ mode: c.mode, user_id: USER_B }, TOKEN_A), runs)),
        [200, null],
      );
      assertEquals(await outcome(await c.handle(post({ user_id: USER_B }, SERVICE), runs)), [
        200,
        null,
      ]);
      assertEquals(runs, [
        [USER_A, false],
        [USER_B, true],
      ]);
    },
  );
}
