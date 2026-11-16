import type { AirheadDb } from './db';
import { newItem, save, softDelete, update } from './repository';
import type { Item, Page, Topic } from '../schemas/records';

/** A topic is shown as a reading topic from this many reading items (Task 16.6). */
export const TOPIC_MIN_READING = 3;

export interface ReadingTopic {
  topic: Topic;
  page: Page | null;
  reading: Item[];
  lastAdded: string | null;
}

/** Topics with 3 or more reading items, newest addition first (Task 16.6). */
export async function readingTopics(db: AirheadDb): Promise<ReadingTopic[]> {
  const [topics, reading, pages] = await Promise.all([
    db.topics.filter((t) => !t.deleted_at).toArray(),
    db.items
      .where('type')
      .equals('reading')
      .filter((i) => !i.deleted_at)
      .toArray(),
    db.pages.filter((p) => p.kind === 'topic' && !p.deleted_at).toArray(),
  ]);
  const pageFor = new Map(pages.map((p) => [p.key.replace(/^topic:/, ''), p]));
  return topics
    .map((topic) => {
      const items = reading
        .filter((i) => i.topic_ids.includes(topic.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return {
        topic,
        page: pageFor.get(topic.id) ?? null,
        reading: items,
        lastAdded: items[0]?.created_at ?? null,
      };
    })
    .filter((t) => t.reading.length >= TOPIC_MIN_READING)
    .sort((a, b) => (b.lastAdded ?? '').localeCompare(a.lastAdded ?? ''));
}

/** Renames a topic and its page together. */
export async function renameTopic(db: AirheadDb, t: ReadingTopic, name: string): Promise<void> {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) return;
  await update(db, 'topics', t.topic.id, { name: clean });
  if (t.page) await update(db, 'pages', t.page.id, { name: clean });
}

/**
 * Merges topic `from` into `into`: every item moves over and `from` goes. The
 * server's page drain moves the links; `from`'s page is archived.
 */
export async function mergeTopics(db: AirheadDb, from: ReadingTopic, into: Topic): Promise<void> {
  const items = await db.items.filter((i) => i.topic_ids.includes(from.topic.id)).toArray();
  for (const i of items) {
    const ids = [...new Set(i.topic_ids.map((id) => (id === from.topic.id ? into.id : id)))];
    await update(db, 'items', i.id, { topic_ids: ids });
  }
  if (from.page) await update(db, 'pages', from.page.id, { status: 'archived' });
  await softDelete(db, 'topics', from.topic.id);
}

/** Asks the server to collate the topic again from every link tonight. */
export async function collateTopic(db: AirheadDb, page: Page): Promise<void> {
  await update(db, 'pages', page.id, { rebuild_requested_at: new Date().toISOString() });
}

/** Sends the topic to the Workshop as an idea with its summary, links and questions. */
export async function topicToWorkshop(
  db: AirheadDb,
  userId: string,
  t: ReadingTopic,
): Promise<Item> {
  const lines = [
    t.page?.summary ?? '',
    '',
    ...t.reading.map(
      (i) => `- ${i.title}${typeof i.data.url === 'string' ? ` (${i.data.url})` : ''}`,
    ),
    ...(t.page?.collation.open_questions?.length
      ? ['', 'Open questions:', ...t.page.collation.open_questions.map((q) => `- ${q}`)]
      : []),
  ];
  return save(
    db,
    'items',
    newItem(userId, {
      type: 'idea',
      title: t.topic.name,
      body: lines.join('\n').trim(),
      topic_ids: [t.topic.id],
      data: { workshop: true, from_topic: t.topic.id },
    }),
  );
}
