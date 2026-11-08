import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.6.0/helpers/zod';
import { countUnionParams, MAX_UNION_PARAMS } from './limits.ts';
import { readAction, SortResult } from './sort.ts';

Deno.test('the sorting output schema stays within the API union-parameter limit', () => {
  const format = zodOutputFormat(SortResult) as unknown as { schema: unknown };
  const n = countUnionParams(format.schema);
  console.log(`sort-batch union params: ${n}`);
  assert(n <= MAX_UNION_PARAMS, `${n} union params (limit ${MAX_UNION_PARAMS})`);
});

Deno.test(
  'action details are read leniently: bad fields become null, values may be plain JSON',
  () => {
    const a = readAction({
      kind: 'update_work_setting',
      quote: 'I get 23 days',
      confidence: 0.9,
      details: '{"setting": "entitlement", "value": 23, "days": "lots", "other_matches": "x"}',
    });
    assertEquals(
      [a.setting, a.value, a.days, a.other_matches, a.start_at],
      ['entitlement', '23', null, [], null],
    );
    const broken = readAction({ kind: 'book_leave', quote: 'q', confidence: 0.5, details: 'nope' });
    assertEquals([broken.start_date, broken.other_matches], [null, []]);
  },
);

// Every structured-output schema in use (2026-11-08).
import { AskResult } from '../../ask/run.ts';
import { ContradictionsResult } from '../../check-contradictions/check.ts';
import { ImportResult } from '../../import-extract/extract.ts';
import { BriefResult } from '../../morning-brief/brief.ts';
import { SummaryResult } from '../../summarise-note/run.ts';
import { LeaveResult } from '../../suggest-leave/run.ts';
import { ReviewResult } from '../../weekly-review/review.ts';
import { DraftContent } from '../../workshop/run.ts';
import { TurnResult } from '../../workshop/turn.ts';

Deno.test('every AI output schema stays within the union-parameter limit', () => {
  const all = {
    AskResult,
    BriefResult,
    ContradictionsResult,
    DraftContent,
    ImportResult,
    LeaveResult,
    ReviewResult,
    SummaryResult,
    TurnResult,
  };
  for (const [name, schema] of Object.entries(all)) {
    const n = countUnionParams(
      (zodOutputFormat(schema as never) as unknown as { schema: unknown }).schema,
    );
    assert(n <= MAX_UNION_PARAMS, `${name}: ${n} union params (limit ${MAX_UNION_PARAMS})`);
  }
});
