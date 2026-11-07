import type { Item, LearnedRule, MemoryFact } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, newItem, save, softDelete, update } from './repository';

const firstWord = (text: string) =>
  (text.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** The enabled rule whose prefix is the capture's first word (learned on the server). */
export function matchRule(rules: LearnedRule[], text: string): LearnedRule | undefined {
  const word = firstWord(text);
  if (!word) return undefined;
  return rules.find(
    (r) => r.enabled && !r.deleted_at && r.match_kind === 'prefix' && r.pattern === word,
  );
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Builds the item a rule sorts a capture into (list entries drop the prefix word: "buy milk" → "Milk"). */
export function ruleItemFor(
  rule: LearnedRule,
  userId: string,
  captureId: string,
  text: string,
): Item {
  const rest = text
    .trim()
    .split(/\s+/)
    .slice(1)
    .join(' ')
    .replace(/^[,:;-]\s*/, '');
  const title = capitalise(rule.result.type === 'list_entry' && rest ? rest : text.trim());
  return newItem(userId, {
    type: rule.result.type,
    title,
    capture_id: captureId,
    list_id: rule.result.list_id ?? null,
    calendar: rule.result.calendar ?? (rule.result.type === 'event' ? 'personal' : null),
    data: { rule_id: rule.id },
  });
}

export const setRuleEnabled = (db: AirheadDb, ruleId: string, enabled: boolean) =>
  update(db, 'learned_rules', ruleId, { enabled });

/** A correction against a rule-sorted item switches that rule off. */
export async function disableRuleForCapture(db: AirheadDb, captureId: string | null) {
  if (!captureId) return;
  const ruleId = (await db.captures.get(captureId))?.payload.rule_id;
  if (typeof ruleId === 'string') await setRuleEnabled(db, ruleId, false);
}

export const addFact = (
  db: AirheadDb,
  userId: string,
  text: string,
  category: MemoryFact['category'],
) =>
  save(db, 'memory_facts', {
    ...baseRecord(userId),
    text: text.trim(),
    category,
    status: 'active',
    source_capture_id: null,
    last_used_at: null,
  });

export const approveFact = (db: AirheadDb, id: string) =>
  update(db, 'memory_facts', id, { status: 'active' });
export const rejectFact = (db: AirheadDb, id: string) => softDelete(db, 'memory_facts', id);
export const archiveFact = (db: AirheadDb, id: string) =>
  update(db, 'memory_facts', id, { status: 'archived' });
export const restoreFact = (db: AirheadDb, id: string) =>
  update(db, 'memory_facts', id, { status: 'active' });
export const editFact = (db: AirheadDb, id: string, text: string) =>
  update(db, 'memory_facts', id, { text: text.trim() });
