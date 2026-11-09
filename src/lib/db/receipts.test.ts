import { describe, expect, it } from 'vitest';
import { aiActionSchema, followUpSchema, type AiAction, type FollowUp } from '../schemas/records';
import { buildReceipt, nextCheck } from './receipts';
import { baseRecord, newCapture, newItem } from './repository';

const U = '11111111-1111-4111-8111-111111111111';
const NOTE =
  'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder';

const action = (o: Partial<AiAction>): AiAction =>
  aiActionSchema.parse({
    ...baseRecord(U),
    capture_id: null,
    kind: 'set_reminder',
    status: 'applied',
    reason: null,
    summary: 'Reminder set',
    quote: '',
    confidence: 0.9,
    payload: {},
    target_table: null,
    target_id: null,
    before: null,
    after: null,
    ...o,
  });
const question = (o: Partial<FollowUp>): FollowUp =>
  followUpSchema.parse({
    ...baseRecord(U),
    capture_id: null,
    note_id: null,
    item_id: null,
    question: 'Who are the sandwiches for?',
    options: [],
    status: 'open',
    answer: null,
    round: 1,
    ...o,
  });

describe('What Airhead did (Task 12.3)', () => {
  it('before sorting: waiting, with the next 5-minute check after the 2-minute settle', () => {
    const c = newCapture(U, { text: 'buy milk', captured_at: '2026-11-09T10:04:30.000Z' });
    expect(nextCheck(c.captured_at, new Date('2026-11-09T10:04:31Z')).toISOString()).toBe(
      '2026-11-09T10:10:00.000Z',
    );
    expect(nextCheck(c.captured_at, new Date('2026-11-09T10:12:00Z')).toISOString()).toBe(
      '2026-11-09T10:15:00.000Z',
    );
    const r = buildReceipt(
      c,
      { items: [], actions: [], followUps: [] },
      new Date('2026-11-09T10:04:31Z'),
    );
    expect(r.state).toBe('waiting');
    expect(r.state === 'waiting' && r.text).toMatch(
      /^Waiting for AI sorting \(next check by \d\d:\d\d\)$/,
    );
  });

  it('one line per outcome, each with the words it came from', () => {
    const c = newCapture(U, { text: NOTE, status: 'sorted' });
    const ev = newItem(U, {
      type: 'event',
      title: 'Christmas sandwiches',
      capture_id: c.id,
      data: { quote: 'Planning Christmas sandwiches every week on a Friday' },
      created_at: '2026-11-09T10:00:00.000Z',
    });
    const task = newItem(U, {
      type: 'task',
      title: 'Plan Christmas sandwiches',
      capture_id: c.id,
      data: { quote: 'Still need to plan', planning: true, steps: ['a', 'b', 'c'] },
      created_at: '2026-11-09T10:00:01.000Z',
    });
    const ws = newItem(U, {
      type: 'note',
      title: 'Maybe the shed',
      capture_id: c.id,
      data: { workshop: true, workshop_from: 'leftover' },
      created_at: '2026-11-09T10:00:02.000Z',
    });
    const gone = newItem(U, { type: 'task', title: 'Deleted', capture_id: c.id });
    gone.deleted_at = '2026-11-09T11:00:00.000Z';
    const applied = action({ capture_id: c.id, summary: 'Reminder set', quote: 'the day before' });
    const proposed = action({
      capture_id: c.id,
      status: 'proposed',
      summary: 'Move Team meeting',
      quote: 'moved to Friday',
    });
    const asked = question({ capture_id: c.id });
    const answered = question({
      capture_id: c.id,
      question: 'How many people?',
      status: 'answered',
      answer: '12',
    });
    const r = buildReceipt(c, {
      items: [ev, task, ws, gone],
      actions: [applied, proposed],
      followUps: [asked, answered],
    });
    expect(r.state).toBe('done');
    if (r.state !== 'done') return;
    expect(r.lines.map((l) => [l.kind, l.text, l.quote])).toEqual([
      [
        'item',
        'Made an event: Christmas sandwiches',
        'Planning Christmas sandwiches every week on a Friday',
      ],
      ['item', 'Made a task with 3 steps: Plan Christmas sandwiches', 'Still need to plan'],
      ['workshop', 'Sent to the Workshop: Maybe the shed', 'Maybe the shed'],
      ['applied', 'Reminder set', 'the day before'],
      ['proposed', 'Asks your OK: Move Team meeting', 'moved to Friday'],
      ['question', 'Asked: Who are the sandwiches for?', null],
      ['question', 'Asked: How many people? You said: 12', null],
    ]);
    expect(r.lines[0]).toMatchObject({ to: `/library/item/${ev.id}` });
    expect(r.lines[2]).toMatchObject({ to: `/workshop/${ws.id}` });
  });

  it('nothing came of it: "Kept as written, not acted on", never silent', () => {
    const c = newCapture(U, { text: 'just a thought', status: 'sorted' });
    const r = buildReceipt(c, { items: [], actions: [], followUps: [] });
    expect(r).toEqual({
      state: 'done',
      lines: [
        { kind: 'kept', text: 'Kept as written, not acted on: “just a thought”', quote: null },
      ],
    });
  });

  it('a whole capture sent to the Workshop quotes the capture; undone actions are shown', () => {
    const c = newCapture(U, { text: 'hmm the thing', status: 'sorted' });
    const ws = newItem(U, {
      type: 'note',
      title: 'Hmm the thing',
      capture_id: c.id,
      data: { workshop: true, workshop_from: 'unmapped' },
    });
    const undone = action({ capture_id: c.id, status: 'undone', summary: 'Leave booked' });
    const r = buildReceipt(c, { items: [ws], actions: [undone], followUps: [] });
    expect(r.state === 'done' && r.lines.map((l) => [l.text, l.quote])).toEqual([
      ['Sent to the Workshop: Hmm the thing', 'hmm the thing'],
      ['Undone: Leave booked', null],
    ]);
  });
});
