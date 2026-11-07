import type { AirheadDb, FileRecord } from '../db/db';
import type { Remote } from '../sync/types';

const EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/** Keeps a file on the device and queues it for upload to <user>/<capture>/<file>. */
export async function queueFile(
  db: AirheadDb,
  userId: string,
  captureId: string,
  blob: Blob,
): Promise<FileRecord> {
  const id = crypto.randomUUID();
  const mime = blob.type || 'application/octet-stream';
  const record: FileRecord = {
    id,
    user_id: userId,
    capture_id: captureId,
    path: `${userId}/${captureId}/${id}.${EXT[mime] ?? 'bin'}`,
    mime,
    size: blob.size,
    data: await blob.arrayBuffer(),
    uploaded: false,
    created_at: new Date().toISOString(),
  };
  await db.files.put(record);
  return record;
}

/** Uploads every queued file. Throws on network failure (the queue is kept). */
export async function uploadPending(db: AirheadDb, remote: Remote): Promise<void> {
  if (!remote.uploadFile) return;
  const pending = (await db.files.toArray()).filter((f) => !f.uploaded);
  for (const file of pending) {
    await remote.uploadFile(file.path, new Blob([file.data], { type: file.mime }));
    // put (not update): update's object copy can mangle the stored bytes.
    await db.files.put({ ...file, uploaded: true });
  }
}

/** Keeps an import's original file with its series: <user>/series/<series>/<name>. */
export async function queueSeriesFile(
  db: AirheadDb,
  userId: string,
  seriesId: string,
  file: Blob,
  name: string,
): Promise<FileRecord> {
  const id = crypto.randomUUID();
  const safe =
    name
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(-80) || 'import';
  const record: FileRecord = {
    id,
    user_id: userId,
    // The files table indexes this column; for series files it holds the series id.
    capture_id: seriesId,
    path: `${userId}/series/${seriesId}/${safe}`,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    data: await file.arrayBuffer(),
    uploaded: false,
    created_at: new Date().toISOString(),
  };
  await db.files.put(record);
  return record;
}
