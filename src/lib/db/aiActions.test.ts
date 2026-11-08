import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aiActionSchema, type AiAction } from '../schemas/records';
import { applyProposal, chipFor, dismissAction, fixLink, undoAction } from './aiActions';
import { openUserDb, type AirheadDb } from './db';
import { baseRecord, newItem, save } from './repository';
import { updateSettingsData } from './settings';

const U = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${U}-ai-actions`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

async function action(o: Partial<AiAction>): Promise<AiAction> {
  return save(
    db,
    'ai_actions',
    aiActionSchema.parse({
      ...baseRecord(U),
      capture_id: null,
      kind: 'set_leave_remaining',
      status: 'applied',
      reason: null,
      summary: 'Leave left set to 9.5 days',
      quote: '9.5 days left',
      confidence: 0.9,
      payload: {},
      target_table: 'settings',
      target_id: U,
      before: null,
      after: null,
      ...o,
    }),
  );
}
const work = async () => (await db.settings.get(U))?.data.work;

describe('undo', () => {
  it('restores a settings key when nothing changed since (null removes it)', async () => {
    await updateSettingsData(db, U, {
      work: { entitlement: 21, opening_used: { '2025-12-01': 11.5 } },
    });
    const a = await action({
      before: { opening_used: null },
      after: { opening_used: { '2025-12-01': 11.5 } },
    });
    expect(await undoAction(db, U, a)).toBe('undone');
    expect(await work()).toEqual({ entitlement: 21 });
    expect((await db.ai_actions.get(a.id))?.status).toBe('undone');
  });

  it('refuses when the value was changed by hand since', async () => {
    await updateSettingsData(db, U, { work: { opening_used: { '2025-12-01': 3 } } });
    const a = await action({
      before: { opening_used: null },
      after: { opening_used: { '2025-12-01': 11.5 } },
    });
    expect(await undoAction(db, U, a)).toBe('changed');
    expect(await work()).toEqual({ opening_used: { '2025-12-01': 3 } });
  });

  it('removes a booked leave', async () => {
    const b = await save(db, 'leave_bookings', {
      ...baseRecord(U),
      start_date: '2026-12-22',
      end_date: '2026-12-24',
      start_half: false,
      end_half: false,
      leave_type: 'annual',
      status: 'planned',
      share_us: false,
      days: 3,
      note: null,
      capture_id: null,
    });
    const a = await action({ kind: 'book_leave', target_table: 'leave_bookings', target_id: b.id });
    expect(await undoAction(db, U, a)).toBe('undone');
    expect((await db.leave_bookings.get(b.id))?.deleted_at).toBeTruthy();
  });

  it('moves an item back, even when the server wrote its times differently', async () => {
    const item = await save(db, 'items', {
      ...newItem(U, { type: 'event', title: 'Dentist' }),
      start_at: '2026-11-12T16:00:00+00:00',
      end_at: '2026-11-12T17:00:00+00:00',
    });
    const a = await action({
      kind: 'reschedule_item',
      target_table: 'items',
      target_id: item.id,
      before: {
        start_at: '2026-11-10T15:00:00.000Z',
        end_at: '2026-11-10T16:00:00.000Z',
        all_day: false,
        updated_at: 'x',
      },
      after: {
        start_at: '2026-11-12T16:00:00.000Z',
        end_at: '2026-11-12T17:00:00.000Z',
        all_day: false,
      },
    });
    expect(await undoAction(db, U, a)).toBe('undone');
    expect((await db.items.get(item.id))?.start_at).toBe('2026-11-10T15:00:00.000Z');
  });

  it('leaves an item alone if it was moved again by hand', async () => {
    const item = await save(db, 'items', {
      ...newItem(U, { type: 'event', title: 'Dentist' }),
      start_at: '2026-11-13T09:00:00.000Z',
    });
    const a = await action({
      kind: 'reschedule_item',
      target_table: 'items',
      target_id: item.id,
      before: { start_at: '2026-11-10T15:00:00.000Z' },
      after: { start_at: '2026-11-12T16:00:00.000Z' },
    });
    expect(await undoAction(db, U, a)).toBe('changed');
  });
});

describe('proposals', () => {
  it('Apply writes the proposed value and marks it applied', async () => {
    await updateSettingsData(db, U, { work: { entitlement: 21 } });
    const a = await action({
      kind: 'update_work_setting',
      status: 'proposed',
      before: { entitlement: 21 },
      after: { entitlement: 23 },
    });
    expect(await applyProposal(db, U, a)).toBe('applied');
    expect(await work()).toEqual({ entitlement: 23 });
    expect((await db.ai_actions.get(a.id))?.status).toBe('applied');
  });

  it('a proposal with nothing to apply needs fixing on its screen', async () => {
    const a = await action({ status: 'proposed', after: null });
    expect(await applyProposal(db, U, a)).toBe('needs_fix');
    expect(fixLink(a)).toBe('/work');
  });

  it('"Which one?" moves the item picked, keeping its length', async () => {
    const pick = await save(db, 'items', {
      ...newItem(U, { type: 'event', title: 'Team meeting' }),
      start_at: '2026-11-11T09:00:00.000Z',
      end_at: '2026-11-11T10:00:00.000Z',
    });
    const a = await action({
      kind: 'reschedule_item',
      status: 'proposed',
      target_table: null,
      target_id: null,
      payload: { choices: ['x', pick.id], start_at: '2026-11-13T10:00:00+00:00' },
    });
    expect(await applyProposal(db, U, a, pick.id)).toBe('applied');
    const moved = await db.items.get(pick.id);
    expect([moved?.start_at, moved?.end_at]).toEqual([
      '2026-11-13T10:00:00.000Z',
      '2026-11-13T11:00:00.000Z',
    ]);
    expect((await db.ai_actions.get(a.id))?.before).toMatchObject({
      start_at: '2026-11-11T09:00:00.000Z',
    });
  });

  it('a proposed booking is booked unless leave now overlaps it', async () => {
    const a = await action({
      kind: 'book_leave',
      status: 'proposed',
      target_table: 'leave_bookings',
      target_id: '22222222-2222-4222-8222-222222222222',
      after: { start_date: '2026-12-22', end_date: '2026-12-24', leave_type: 'annual', days: 3 },
    });
    expect(await applyProposal(db, U, a)).toBe('applied');
    expect((await db.leave_bookings.get('22222222-2222-4222-8222-222222222222'))?.days).toBe(3);
    const again = await action({ ...a, id: crypto.randomUUID(), status: 'proposed' });
    expect(await applyProposal(db, U, again)).toBe('changed');
  });

  it('Dismiss just marks it', async () => {
    const a = await action({ status: 'proposed' });
    await dismissAction(db, a);
    expect((await db.ai_actions.get(a.id))?.status).toBe('dismissed');
  });
});

describe('chips', () => {
  const a = (status: AiAction['status'], summary = 'Leave left set to 9.5 days') =>
    ({ status, summary }) as AiAction;
  it('says what was done, or that something needs an OK', () => {
    expect(chipFor([a('applied')])).toBe('Leave left set to 9.5 days');
    expect(chipFor([a('applied'), a('applied', 'Entitlement set to 23 days')])).toBe(
      'Leave left set to 9.5 days (+1 more)',
    );
    expect(chipFor([a('applied'), a('proposed')])).toBe('1 action needs your OK');
    expect(chipFor([a('undone'), a('dismissed'), a('skipped')])).toBeNull();
  });
});
