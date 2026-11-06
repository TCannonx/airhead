import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openUserDb, type AirheadDb } from '../db/db';
import { createFakeRemote } from '../sync/fakeRemote';
import { queueFile, uploadPending } from './upload';

const USER = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${USER}-files`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('file upload queue', () => {
  it('stores the file locally under <user>/<capture>/<file> and uploads it when online', async () => {
    const remote = createFakeRemote();
    const blob = new Blob(['img'], { type: 'image/webp' });
    const file = await queueFile(db, USER, 'cap-1', blob);
    expect(file.path).toBe(`${USER}/cap-1/${file.id}.webp`);
    expect((await db.files.get(file.id))?.uploaded).toBe(false);

    remote.state.online = false;
    await expect(uploadPending(db, remote)).rejects.toThrow();
    expect((await db.files.get(file.id))?.uploaded).toBe(false);

    remote.state.online = true;
    await uploadPending(db, remote);
    expect(remote.files.get(file.path)?.type).toBe('image/webp');
    expect((await db.files.get(file.id))?.uploaded).toBe(true);
    // The blob stays cached on the device for offline viewing.
    expect((await db.files.get(file.id))?.data.byteLength).toBe(3);
  });

  it('uses .jpg when the browser could not encode WebP', async () => {
    const file = await queueFile(db, USER, 'cap-2', new Blob(['x'], { type: 'image/jpeg' }));
    expect(file.path.endsWith('.jpg')).toBe(true);
  });
});
