import type { AirheadDb } from '../db/db';
import { archiveFact, editFact, rejectFact, setRuleEnabled } from '../db/memory';
import { softDelete } from '../db/repository';
import type { Fix } from './checkup';

/** Applies a check-up finding's one-tap fix. Returns false for fixes the UI handles (navigation, sync). */
export async function applyFix(db: AirheadDb, fix: Fix): Promise<boolean> {
  switch (fix.action) {
    case 'merge_facts':
      for (const id of fix.remove) await rejectFact(db, id);
      return true;
    case 'archive_facts':
      for (const id of fix.ids) await archiveFact(db, id);
      return true;
    case 'delete_rules':
      for (const id of fix.ids) await softDelete(db, 'learned_rules', id);
      return true;
    case 'disable_rules':
      for (const id of fix.ids) await setRuleEnabled(db, id, false);
      return true;
    default:
      return false;
  }
}

/** Resolves a contradiction: keep the first fact (optionally with merged text), remove the other. */
export async function resolveContradiction(
  db: AirheadDb,
  keepId: string,
  removeId: string,
  mergedText: string | null,
) {
  if (mergedText) await editFact(db, keepId, mergedText);
  await rejectFact(db, removeId);
}
