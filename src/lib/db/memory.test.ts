import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from './captures';
import { openUserDb, type AirheadDb } from './db';
import { createList } from './lists';
import { addFact, approveFact, matchRule, rejectFact, setRuleEnabled } from './memory';
import { baseRecord, save } from './repository';
import { changeItemType } from './sorting';

const U = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${U}-memory`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

async function buyRule(listId: string, enabled = true) {
  return save(db, 'learned_rules', {
    ...baseRecord(U),
    pattern: 'buy',
    match_kind: 'prefix',
    result: { type: 'list_entry', list_id: listId },
    hits: 4,
    enabled,
  });
}

describe('learned rules on the device', () => {
  it('matches the first word, ignoring case and punctuation', async () => {
    const shop = await createList(db, U, 'Shopping');
    const rule = await buyRule(shop.id);
    const rules = await db.learned_rules.toArray();
    expect(matchRule(rules, 'Buy, oat milk')?.id).toBe(rule.id);
    expect(matchRule(rules, 'buyer meeting')).toBeUndefined();
    expect(matchRule(rules, 'call mum')).toBeUndefined();
  });

  it('a capture matching a rule is sorted instantly and offline, without AI', async () => {
    const shop = await createList(db, U, 'Shopping');
    const rule = await buyRule(shop.id);
    const { capture, ruleItem } = await createCapture(db, U, { text: 'buy oat milk' });

    expect(capture.status).toBe('sorted');
    expect(capture.payload.rule_id).toBe(rule.id);
    expect(ruleItem).toMatchObject({
      type: 'list_entry',
      list_id: shop.id,
      title: 'Oat milk',
      status: 'open',
    });
    expect((await db.learned_rules.get(rule.id))?.hits).toBe(5);
  });

  it('a switched-off rule is not applied', async () => {
    const shop = await createList(db, U, 'Shopping');
    await buyRule(shop.id, false);
    const { capture, ruleItem } = await createCapture(db, U, { text: 'buy oat milk' });
    expect(capture.status).toBe('unsorted');
    expect(ruleItem).toBeNull();
  });

  it('correcting an item a rule sorted switches the rule off', async () => {
    const shop = await createList(db, U, 'Shopping');
    const rule = await buyRule(shop.id);
    const { ruleItem } = await createCapture(db, U, { text: 'buy a new bike' });
    await changeItemType(db, U, ruleItem?.id ?? '', 'task');
    expect((await db.learned_rules.get(rule.id))?.enabled).toBe(false);
    expect(await db.corrections.count()).toBe(1);
  });

  it('rules can be switched on and off by hand', async () => {
    const shop = await createList(db, U, 'Shopping');
    const rule = await buyRule(shop.id);
    await setRuleEnabled(db, rule.id, false);
    expect((await db.learned_rules.get(rule.id))?.enabled).toBe(false);
  });
});

describe('memory facts on the device', () => {
  it('added by hand: active; approve and reject waiting facts', async () => {
    const mine = await addFact(db, U, 'Lives in Dublin', 'everyday');
    expect(mine.status).toBe('active');

    const waiting = await save(db, 'memory_facts', {
      ...baseRecord(U),
      text: 'Jim is a close friend',
      category: 'person',
      status: 'pending_approval',
      source_capture_id: null,
      last_used_at: null,
    });
    await approveFact(db, waiting.id);
    expect((await db.memory_facts.get(waiting.id))?.status).toBe('active');
    await rejectFact(db, waiting.id);
    expect((await db.memory_facts.get(waiting.id))?.deleted_at).not.toBeNull();
  });
});
