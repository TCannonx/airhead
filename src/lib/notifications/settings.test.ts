import { describe, expect, it } from 'vitest';
import type { SettingsRow } from '../schemas/records';
import { DEFAULT_NOTIF, readNotifSettings } from './settings';

const row = (notifications: unknown): SettingsRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  user_id: '22222222-2222-4222-8222-222222222222',
  created_at: '2026-07-01T09:00:00Z',
  updated_at: '2026-07-01T09:00:00Z',
  server_updated_at: null,
  deleted_at: null,
  data: { notifications },
});

describe('notification settings (Task 4.15)', () => {
  it('defaults match the scheduler: everything on, 22:00–07:30 quiet, 8 a day, 30-minute reminders', () => {
    expect(readNotifSettings(undefined)).toEqual(DEFAULT_NOTIF);
    expect(DEFAULT_NOTIF).toMatchObject({
      quiet_start: '22:00',
      quiet_end: '07:30',
      quiet_allows_events: true,
      daily_cap: 8,
      evening_review_time: '21:00',
      checklist_time: '20:00',
      morning_time: '08:00',
      event_reminder_minutes: 30,
    });
    expect(Object.values(DEFAULT_NOTIF.types).every(Boolean)).toBe(true);
  });

  it('keeps valid fields and per-type switches when another field is bad', () => {
    const s = readNotifSettings(
      row({ daily_cap: 0, quiet_start: '23:00', types: { slip: false, nonsense: 1 } }),
    );
    expect(s.daily_cap).toBe(8);
    expect(s.quiet_start).toBe('23:00');
    expect(s.types.slip).toBe(false);
    expect(s.types.event_reminder).toBe(true);
  });
});
