import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draftSchema, workshopSessionSchema } from '../schemas/records';
import { openUserDb, type AirheadDb } from './db';
import { newItem, save } from './repository';
import {
  addDraft,
  draftsFor,
  inWorkshop,
  leaveWorkshop,
  sendToWorkshop,
  sessionFor,
} from './workshop';

const U = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;
beforeEach(async () => {
  db = openUserDb(`${U}-workshop`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const CONTENT = { summary: 'A shed', sections: [], open_questions: [], next_steps: [] };

describe('Workshop data (Task 7.5)', () => {
  it('sends an item to the Workshop and back', async () => {
    const idea = await save(db, 'items', newItem(U, { type: 'idea', title: 'Garden shed' }));
    await sendToWorkshop(db, idea);
    const sent = await db.items.get(idea.id);
    expect(sent && inWorkshop(sent)).toBe(true);
    if (sent) await leaveWorkshop(db, sent);
    const back = await db.items.get(idea.id);
    expect(back && inWorkshop(back)).toBe(false);
  });

  it('drafts are versions, newest first, queued for sync', async () => {
    const itemId = crypto.randomUUID();
    await addDraft(db, U, itemId, CONTENT, 'auto');
    await addDraft(db, U, itemId, { ...CONTENT, summary: 'A bigger shed' }, 'session');
    const drafts = await draftsFor(db, itemId);
    expect(drafts.map((d) => [d.version, d.content.summary, d.source])).toEqual([
      [2, 'A bigger shed', 'session'],
      [1, 'A shed', 'auto'],
    ]);
    expect(await db.outbox.where('table').equals('drafts').count()).toBe(2);
  });

  it('schemas accept the server rows and reject bad content', () => {
    const base = {
      id: crypto.randomUUID(),
      user_id: U,
      created_at: '2026-07-15T10:00:00+00:00',
      updated_at: '2026-07-15T10:00:00+00:00',
      server_updated_at: null,
      deleted_at: null,
    };
    expect(
      draftSchema.safeParse({
        ...base,
        item_id: base.id,
        version: 3,
        content: CONTENT,
        source: 'edit',
      }).success,
    ).toBe(true);
    expect(
      draftSchema.safeParse({ ...base, item_id: base.id, version: 1, content: {}, source: 'auto' })
        .success,
    ).toBe(true);
    expect(
      draftSchema.safeParse({
        ...base,
        item_id: base.id,
        version: 1,
        content: CONTENT,
        source: 'x',
      }).success,
    ).toBe(false);
    expect(
      workshopSessionSchema.safeParse({
        ...base,
        turns: [{ role: 'airhead', text: 'Who is it for?', at: base.created_at }],
        pending: { text: 'Me', at: base.created_at },
      }).success,
    ).toBe(true);
  });

  it('a session is found by its item', async () => {
    const itemId = crypto.randomUUID();
    expect(await sessionFor(db, itemId)).toBeUndefined();
    await save(db, 'workshop_sessions', {
      id: itemId,
      user_id: U,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      server_updated_at: null,
      deleted_at: null,
      turns: [],
      pending: null,
    });
    expect((await sessionFor(db, itemId))?.id).toBe(itemId);
  });
});
