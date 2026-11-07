import JSZip from 'jszip';
import type { AirheadDb } from '../db/db';
import { SYNC_TABLES, type Item } from '../schemas/records';

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60) || 'untitled';

/** Quote a YAML scalar only when it would otherwise be misread (": ", " #", special first char). */
const yaml = (v: string) =>
  /: |\s#|^[\s\-?:,[\]{}#&*!|>'"%@`]|\s$/.test(v) ? JSON.stringify(v) : v;

/** One readable Markdown file for an item: front matter, title, body, original capture. */
export function itemMarkdown(
  item: Item,
  extra: { topics?: string[]; captureText?: string | null } = {},
): string {
  const front: [string, string | null | undefined][] = [
    ['type', item.type],
    ['status', item.status],
    ['created', item.created_at],
    ['start', item.start_at],
    ['end', item.end_at],
    ['due', item.due_at],
    ['all_day', item.type === 'event' ? String(item.all_day) : null],
    ['repeats', item.rrule],
    ['calendar', item.calendar],
    ['url', typeof item.data.url === 'string' ? item.data.url : null],
    ['topics', extra.topics?.length ? `[${extra.topics.map(yaml).join(', ')}]` : null],
    ['id', item.id],
  ];
  const lines = ['---'];
  for (const [k, v] of front) if (v) lines.push(`${k}: ${k === 'topics' ? v : yaml(v)}`);
  lines.push('---', '', `# ${item.title || '(untitled)'}`, '');
  if (item.body) lines.push(item.body, '');
  if (extra.captureText) {
    lines.push(
      '## Original capture',
      '',
      ...extra.captureText.split('\n').map((l) => `> ${l}`),
      '',
    );
  }
  return lines.join('\n');
}

export const exportFileName = (now = new Date()) =>
  `airhead-export-${now.toISOString().slice(0, 10)}.zip`;

/**
 * Everything on this device as a zip: data.json (every row of every synced
 * table, deleted ones included, for backup and re-import), one Markdown file
 * per live item, and attached files. Doubles as a backup and avoids lock-in.
 */
export async function buildExport(db: AirheadDb, now = new Date()): Promise<Blob> {
  const zip = new JSZip();
  const tables: Record<string, unknown[]> = {};
  for (const t of SYNC_TABLES) tables[t] = await db.table(t).toArray();

  zip.file(
    'data.json',
    JSON.stringify(
      { format: 'airhead-export', version: 1, exported_at: now.toISOString(), tables },
      null,
      2,
    ),
  );

  const items = (tables.items as Item[]).filter((i) => !i.deleted_at);
  const topicName = new Map((await db.topics.toArray()).map((t) => [t.id, t.name]));
  const captureText = new Map((await db.captures.toArray()).map((c) => [c.id, c.text]));
  const used = new Set<string>();
  for (const item of items) {
    const base = `items/${item.type}/${item.created_at.slice(0, 10)}-${slug(item.title)}`;
    let name = `${base}.md`;
    if (used.has(name)) name = `${base}-${item.id.slice(0, 8)}.md`;
    used.add(name);
    zip.file(
      name,
      itemMarkdown(item, {
        topics: item.topic_ids.map((id) => topicName.get(id)).filter((n): n is string => !!n),
        captureText: item.capture_id ? captureText.get(item.capture_id) : null,
      }),
    );
  }

  for (const f of await db.files.toArray()) zip.file(`files/${f.path}`, f.data);

  zip.file(
    'README.md',
    '# Airhead export\n\n- `data.json`: every table, every row (machine-readable backup).\n- `items/`: one Markdown file per item, by type.\n- `files/`: attached photos and files.\n',
  );
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Builds the export and hands it to the browser as a download. */
export async function downloadExport(db: AirheadDb): Promise<void> {
  const blob = await buildExport(db);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
