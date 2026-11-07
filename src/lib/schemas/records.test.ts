import { describe, expect, it } from 'vitest';
import { feedSchema, leaveBookingSchema, schemas, SYNC_TABLES, workDaySchema } from './records';

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
