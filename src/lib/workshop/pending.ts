import type { AirheadDb } from '../db/db';

/**
 * An answer typed while offline (Task 7.7) waits on this device (the local
 * `meta` table, not synced) and is sent when the connection is back. Session
 * turns themselves are written only by the server, so a stale device copy can
 * never overwrite newer turns.
 */
export interface PendingAnswer {
  text: string;
  at: string;
}

const key = (itemId: string) => `workshop_pending:${itemId}`;

export async function getPending(db: AirheadDb, itemId: string): Promise<PendingAnswer | null> {
  const row = await db.meta.get(key(itemId));
  const v = row?.value as Partial<PendingAnswer> | undefined;
  return v && typeof v.text === 'string' ? { text: v.text, at: String(v.at ?? '') } : null;
}

export async function setPending(db: AirheadDb, itemId: string, text: string): Promise<void> {
  await db.meta.put({ key: key(itemId), value: { text, at: new Date().toISOString() } });
}

export async function clearPending(db: AirheadDb, itemId: string): Promise<void> {
  await db.meta.delete(key(itemId));
}
