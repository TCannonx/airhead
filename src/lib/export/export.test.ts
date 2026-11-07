import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from '../db/captures';
import { openUserDb, type AirheadDb } from '../db/db';
import { baseRecord, newItem, save, softDelete } from '../db/repository';
import { SYNC_TABLES } from '../schemas/records';
import { buildExport, itemMarkdown, exportFileName } from './export';

const U = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;

beforeEach(async () => {
  db = openUserDb(`${U}-export`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

async function seed() {
  const topic = await save(db, 'topics', { ...baseRecord(U), name: 'Garden' });
  await save(
    db,
    'items',
    newItem(U, {
      type: 'idea',
      title: 'Raised beds / cedar',
      body: 'Two beds.',
      topic_ids: [topic.id],
    }),
  );
  await createCapture(db, U, { text: 'read https://example.com/compost later' });
  await createCapture(db, U, { text: 'buy milk' });
  await createCapture(db, U, {
    text: 'photo',
    photo: new Blob(['jpegbytes'], { type: 'image/jpeg' }),
  });
  const gone = await save(db, 'items', newItem(U, { type: 'note', title: 'Binned' }));
  await softDelete(db, 'items', gone.id);
}

describe('export everything', () => {
  it('JSON round-trips with the same row counts for every table', async () => {
    await seed();
    const zip = await JSZip.loadAsync(await buildExport(db));
    const json = JSON.parse((await zip.file('data.json')?.async('string')) ?? '{}');

    expect(json.format).toBe('airhead-export');
    expect(json.version).toBe(1);
    for (const table of SYNC_TABLES) {
      expect(json.tables[table], table).toHaveLength(await db.table(table).count());
    }
    expect(json.tables.items.some((i: { title: string }) => i.title === 'Binned')).toBe(true);
  });

  it('has one Markdown file per live item, and the photos', async () => {
    await seed();
    const zip = await JSZip.loadAsync(await buildExport(db));
    const md = Object.keys(zip.files).filter((n) => n.startsWith('items/') && n.endsWith('.md'));
    const live = (await db.items.toArray()).filter((i) => !i.deleted_at);
    expect(md).toHaveLength(live.length);
    expect(md.some((n) => n.startsWith('items/idea/') && n.includes('raised-beds-cedar'))).toBe(
      true,
    );

    const files = Object.keys(zip.files).filter(
      (n) => n.startsWith('files/') && !zip.files[n]?.dir,
    );
    expect(files).toHaveLength(1);
    expect(await zip.file(files[0] ?? '')?.async('string')).toBe('jpegbytes');
  });

  it('writes readable Markdown with front matter, topics and the original capture', () => {
    const item = newItem(U, {
      type: 'reading',
      title: 'Compost guide',
      body: 'Key points here.',
      data: { url: 'https://example.com/compost' },
    });
    const md = itemMarkdown(item, {
      topics: ['Garden'],
      captureText: 'read https://example.com/compost later',
    });
    expect(md).toContain('# Compost guide');
    expect(md).toMatch(/^---\ntype: reading\n/);
    expect(md).toContain('topics: [Garden]');
    expect(md).toContain('url: https://example.com/compost');
    expect(md).toContain('Key points here.');
    expect(md).toContain('> read https://example.com/compost later');
  });

  it('names the file by date', () => {
    expect(exportFileName(new Date('2026-11-07T09:00:00Z'))).toBe('airhead-export-2026-11-07.zip');
  });
});
