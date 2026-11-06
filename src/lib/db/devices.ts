import type { DeviceRecord } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, save } from './repository';

/**
 * Registers this install as a device, locally first (works offline); sync
 * pushes it. Never renames a device that is already registered.
 */
export async function registerDevice(
  db: AirheadDb,
  userId: string,
  device: { id: string; name: string; platform: string },
): Promise<DeviceRecord> {
  const existing = await db.devices.get(device.id);
  if (existing) return existing;
  return save(db, 'devices', {
    ...baseRecord(userId),
    id: device.id,
    name: device.name,
    platform: device.platform,
    push_subscription: null,
    receives_notifications: false,
    last_sync_at: null,
  });
}
