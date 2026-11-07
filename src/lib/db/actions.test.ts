import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actionsToTasks, parseDue, tasksFromNote } from './actions';
import { openUserDb, type AirheadDb } from './db';

const U = '11111111-1111-4111-8111-111111111111';
const NOTE = { id: '33333333-3333-4333-8333-333333333333' };
// Wednesday 15 July 2026, 10:00 in Dublin.
const NOW = new Date('2026-07-15T09:00:00Z');
let db: AirheadDb;
beforeEach(async () => {
  db = openUserDb(`${U}-actions`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('action items to tasks (Task 6.8)', () => {
  it('reads due text with the free date rules', () => {
    expect(parseDue('Friday', { now: NOW })).toBe('2026-07-16T23:00:00.000Z');
    expect(parseDue('by 3 March', { now: NOW })).toMatch(/^2027-03-0[23]/);
    expect(parseDue('soon-ish', { now: NOW })).toBeNull();
    expect(parseDue(null)).toBeNull();
  });

  it('makes only the picked actions into tasks, linked to the note, once per title', async () => {
    const picks = [
      { title: 'Book the room', owner: 'Mark', due_text: 'Friday' },
      { title: 'Send agenda', owner: null, due_text: null },
      { title: 'send  Agenda ', owner: null, due_text: null },
    ];
    const made = await actionsToTasks(db, U, NOTE, picks, { now: NOW });
    expect(made.map((t) => [t.type, t.title, t.body, t.due_at, t.data])).toEqual([
      [
        'task',
        'Book the room',
        'Owner: Mark',
        '2026-07-16T23:00:00.000Z',
        { note_id: NOTE.id, owner: 'Mark', due_text: 'Friday' },
      ],
      ['task', 'Send agenda', null, null, { note_id: NOTE.id }],
    ]);
    expect(await actionsToTasks(db, U, NOTE, picks, { now: NOW })).toEqual([]);
    expect([...(await tasksFromNote(db, NOTE.id)).keys()].sort()).toEqual([
      'book the room',
      'send agenda',
    ]);
    expect(await db.items.count()).toBe(2);
  });
});
