import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openUserDb, type AirheadDb } from './db';
import { newItem, save } from './repository';
import { repeatText } from '../rules/repeatText';
import { completeTask, nextDue } from './review';

const U = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;
beforeEach(async () => {
  db = openUserDb(`${U}-repeating`);
  await db.open();
});
afterEach(async () => {
  vi.useRealTimers();
  db.close();
  await db.delete();
});

describe('repeating tasks', () => {
  it('the next due time is one interval after the current one', () => {
    expect(
      nextDue(
        'FREQ=WEEKLY;INTERVAL=2',
        '2026-11-09T09:00:00.000Z',
        new Date('2026-11-09T10:00:00Z'),
      ),
    ).toBe('2026-11-23T09:00:00.000Z');
    // Done late: the next one is the first after now, not a missed one.
    expect(
      nextDue(
        'FREQ=WEEKLY;INTERVAL=2',
        '2026-11-09T09:00:00.000Z',
        new Date('2026-11-30T10:00:00Z'),
      ),
    ).toBe('2026-12-07T09:00:00.000Z');
    expect(nextDue('nonsense', '2026-11-09T09:00:00.000Z', new Date())).toBeNull();
    expect(
      nextDue('FREQ=WEEKLY;COUNT=1', '2026-11-09T09:00:00.000Z', new Date('2026-11-10T00:00:00Z')),
    ).toBeNull();
  });

  it('ticking off a repeating task moves it on instead of finishing it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
    const t = await save(db, 'items', {
      ...newItem(U, { type: 'task', title: 'Text barber for haircut' }),
      rrule: 'FREQ=WEEKLY;INTERVAL=2',
      due_at: '2026-11-09T09:00:00.000Z',
      top3_date: '2026-11-09',
    });
    await completeTask(db, t.id);
    const after = await db.items.get(t.id);
    expect(after).toMatchObject({
      status: 'open',
      due_at: '2026-11-23T09:00:00.000Z',
      top3_date: null,
      completed_at: '2026-11-09T10:00:00.000Z',
    });
    expect(after?.data.last_done_at).toBe('2026-11-09T10:00:00.000Z');
  });

  it('a one-off task, or a repeat that has ended, is simply done', async () => {
    const once = await save(db, 'items', newItem(U, { type: 'task', title: 'Get cash' }));
    await completeTask(db, once.id);
    expect((await db.items.get(once.id))?.status).toBe('done');
    const ended = await save(db, 'items', {
      ...newItem(U, { type: 'task', title: 'Last one' }),
      rrule: 'FREQ=WEEKLY;COUNT=1',
      due_at: '2020-01-06T09:00:00.000Z',
    });
    await completeTask(db, ended.id);
    expect((await db.items.get(ended.id))?.status).toBe('done');
  });
});

describe('repeat wording', () => {
  it('reads the rule in plain words', () => {
    expect(repeatText('FREQ=WEEKLY;INTERVAL=2')).toBe('every 2 weeks');
    expect(repeatText('junk')).toBe('junk');
  });
});
