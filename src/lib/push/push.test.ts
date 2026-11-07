import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openUserDb, type AirheadDb } from '../db/db';
import { registerDevice } from '../db/devices';
import { keyBytes, pushSupport, saveSubscription, sendNotificationsHere } from './push';

const U = '11111111-1111-4111-8111-111111111111';
const SUB = { endpoint: 'https://push.test/x', keys: { auth: 'a', p256dh: 'p' } };
let db: AirheadDb;
beforeEach(async () => {
  db = openUserDb(`${U}-push`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const receivers = async () =>
  (await db.devices.toArray()).filter((d) => d.receives_notifications).map((d) => d.name);

describe('push setup (Task 4.11)', () => {
  it('iPhone and iPad need the Home Screen app', () => {
    expect(pushSupport('ios', false)).toBe('needs_install');
    expect(pushSupport('ipados', false)).toBe('needs_install');
  });

  it('decodes the VAPID public key', () => {
    expect([...keyBytes('AQID_w')]).toEqual([1, 2, 3, 255]);
  });

  it('the first device turned on gets the notifications', async () => {
    await registerDevice(db, U, {
      id: '00000000-0000-4000-8000-0000000000a1',
      name: 'Chrome on Mac',
      platform: 'macos',
    });
    await saveSubscription(db, '00000000-0000-4000-8000-0000000000a1', 'macos', SUB);
    expect(await receivers()).toEqual(['Chrome on Mac']);
    expect(
      (await db.devices.get('00000000-0000-4000-8000-0000000000a1'))?.push_subscription,
    ).toEqual(SUB);
  });

  it('an iPhone takes over from another device; an iPad does not', async () => {
    await registerDevice(db, U, {
      id: '00000000-0000-4000-8000-0000000000a1',
      name: 'Chrome on Mac',
      platform: 'macos',
    });
    await registerDevice(db, U, {
      id: '00000000-0000-4000-8000-0000000000a2',
      name: 'iPad',
      platform: 'ipados',
    });
    await registerDevice(db, U, {
      id: '00000000-0000-4000-8000-0000000000a3',
      name: 'iPhone',
      platform: 'ios',
    });
    await saveSubscription(db, '00000000-0000-4000-8000-0000000000a1', 'macos', SUB);
    await saveSubscription(db, '00000000-0000-4000-8000-0000000000a2', 'ipados', SUB);
    expect(await receivers()).toEqual(['Chrome on Mac']);
    await saveSubscription(db, '00000000-0000-4000-8000-0000000000a3', 'ios', SUB);
    expect(await receivers()).toEqual(['iPhone']);
  });

  it('"send them here instead" moves notifications to this device only', async () => {
    await registerDevice(db, U, {
      id: '00000000-0000-4000-8000-0000000000a3',
      name: 'iPhone',
      platform: 'ios',
    });
    await registerDevice(db, U, {
      id: '00000000-0000-4000-8000-0000000000a1',
      name: 'Chrome on Mac',
      platform: 'macos',
    });
    await saveSubscription(db, '00000000-0000-4000-8000-0000000000a3', 'ios', SUB);
    await sendNotificationsHere(db, '00000000-0000-4000-8000-0000000000a1');
    expect(await receivers()).toEqual(['Chrome on Mac']);
  });
});
