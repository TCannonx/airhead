import { describe, expect, it } from 'vitest';
import {
  briefSchema,
  feedSchema,
  leaveBookingSchema,
  schemas,
  SYNC_TABLES,
  aiActionSchema,
  workDaySchema,
} from './records';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  created_at: '2026-07-01T09:00:00+00:00',
  updated_at: '2026-07-01T09:00:00+00:00',
  server_updated_at: null,
  deleted_at: null,
};

describe('calendar record schemas (Task 4.1)', () => {
  it('every synced table has a schema', () => {
    expect(Object.keys(schemas).sort()).toEqual([...SYNC_TABLES].sort());
  });

  it('reads leave days whether PostgREST sends a number or a string', () => {
    const row = {
      ...base,
      start_date: '2026-07-14',
      end_date: '2026-07-18',
      start_half: false,
      end_half: true,
      leave_type: 'annual',
      status: 'planned',
      share_us: true,
      days: '4.5',
      note: null,
      capture_id: null,
    };
    expect(leaveBookingSchema.parse(row).days).toBe(4.5);
    expect(leaveBookingSchema.parse({ ...row, days: 3 }).days).toBe(3);
    expect(leaveBookingSchema.parse({ ...row, days: null }).days).toBeNull();
  });

  it('accepts only hex SHA-256 token hashes on feeds', () => {
    const feed = {
      ...base,
      kind: 'us_out',
      name: 'Us',
      colour: null,
      token_hash: 'ab'.repeat(32),
      url: null,
      enabled: true,
      settings: {},
      last_fetched_at: null,
      last_error: null,
    };
    expect(feedSchema.safeParse(feed).success).toBe(true);
    expect(feedSchema.safeParse({ ...feed, token_hash: 'secret-token' }).success).toBe(false);
  });

  it('checks the work location', () => {
    const day = { ...base, date: '2026-07-14', location: 'office', note: null };
    expect(workDaySchema.safeParse(day).success).toBe(true);
    expect(workDaySchema.safeParse({ ...day, location: 'beach' }).success).toBe(false);
  });
});

describe('brief schema (Task 5.1)', () => {
  it('fills content defaults and reads cost as a number', () => {
    const b = briefSchema.parse({
      ...base,
      local_date: '2027-01-10',
      status: 'fallback',
      content: {},
      model: null,
      cost_eur: '0.012300',
    });
    expect(b.content).toEqual({ reflection: null, top3: [], also_today: [], prep: [] });
    expect(b.cost_eur).toBeCloseTo(0.0123);
  });
});

describe('AI actions (Task 10.2)', () => {
  const row = {
    ...base,
    capture_id: null,
    kind: 'set_leave_remaining',
    status: 'applied',
    reason: null,
    summary: 'Leave left set to 9.5 days',
    quote: '9.5 days left',
    confidence: 0.9,
    payload: {},
    target_table: 'settings',
    target_id: base.user_id,
    before: { opening_used: null },
    after: { opening_used: { '2025-12-01': 11.5 } },
  };
  it('syncs, and checks kind and status', () => {
    expect(SYNC_TABLES).toContain('ai_actions');
    expect(aiActionSchema.parse(row).summary).toBe('Leave left set to 9.5 days');
    expect(() => aiActionSchema.parse({ ...row, kind: 'nope' })).toThrow();
    expect(() => aiActionSchema.parse({ ...row, status: 'maybe' })).toThrow();
  });
});
