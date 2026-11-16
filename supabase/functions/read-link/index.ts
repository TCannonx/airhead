import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { gteSmall } from '../_shared/embed.ts';
import { matchTopics } from '../_shared/topics.ts';
import { enrichLink } from './enrich.ts';
import { linkInfoFor } from './extract.ts';
import { handleReadLink } from './handler.ts';
import { safeFetch } from './safeFetch.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

async function resolve(host: string): Promise<string[]> {
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...a, ...aaaa];
}

/** Matches topic names to the person's topics, creating the missing ones (Task 16.4). */
async function topicIdsFor(userId: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { data: topics } = await db
    .from('topics')
    .select('id, name')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .limit(500);
  const matches = await matchTopics(names, (topics ?? []) as { id: string; name: string }[], (t) =>
    gteSmall(t).catch(() => null),
  );
  const ids: string[] = [];
  for (const m of matches) {
    if (m.id) {
      ids.push(m.id);
      continue;
    }
    const { data } = await db
      .from('topics')
      .insert({ user_id: userId, name: m.name })
      .select('id')
      .maybeSingle();
    if (data?.id) ids.push(data.id as string);
  }
  return ids;
}

/** POST /read-link { capture_id }: see handler.ts. */
Deno.serve((req) =>
  handleReadLink(req, {
    caller: supabaseCaller(db, isService),
    async findCapture(id, owner) {
      let query = db.from('captures').select('id, user_id, url, payload, kind').eq('id', id);
      if (owner) query = query.eq('user_id', owner);
      const { data } = await query.maybeSingle();
      return data;
    },
    async read(capture) {
      const fetched = await safeFetch(capture.url, { fetch, resolve });
      const info = linkInfoFor(capture.url, fetched);
      const now = new Date().toISOString();

      const payload = {
        ...(capture.payload as Record<string, unknown>),
        link: {
          status: info.status,
          title: info.title,
          description: info.description,
          word_count: info.word_count,
          reading_minutes: info.reading_minutes,
          fetched_at: now,
        },
        article_text: info.text,
        // The next sort batch writes the summary and key points, then clears the text.
        summary_pending: info.status === 'read',
      };
      await db.from('captures').update({ payload }).eq('id', capture.id);

      // Every reading item from this capture (Task 16.1), each read and enriched
      // with its own link (Task 16.2).
      const { data: items } = await db
        .from('items')
        .select('id, title, data')
        .eq('capture_id', capture.id)
        .eq('type', 'reading');
      const { data: cap } = await db
        .from('captures')
        .select('text')
        .eq('id', capture.id)
        .maybeSingle();
      const note = String(cap?.text ?? '')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const deps = {
        ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
        usage: supabaseUsageStore(db),
      };
      for (const item of items ?? []) {
        const old = item.data as Record<string, unknown>;
        const url = typeof old.url === 'string' ? old.url : capture.url;
        const page = url === capture.url ? fetched : await safeFetch(url, { fetch, resolve });
        const pageInfo = url === capture.url ? info : linkInfoFor(url, page);
        const link = await enrichLink(deps, {
          userId: capture.user_id,
          url,
          note,
          info: pageInfo,
          fetched: page,
        });
        const data = {
          ...old,
          description: pageInfo.description,
          reading_minutes: pageInfo.reading_minutes,
          couldnt_read: pageInfo.status === 'unreadable',
          link,
        };
        const title = item.title === url && pageInfo.title ? pageInfo.title : item.title;
        // Topics (Task 16.4): the link's topic names matched to the person's topics.
        const topicIds = await topicIdsFor(capture.user_id, link.topics);
        const { data: current } = await db
          .from('items')
          .select('topic_ids')
          .eq('id', item.id)
          .maybeSingle();
        const merged = [
          ...new Set([...((current?.topic_ids as string[] | null) ?? []), ...topicIds]),
        ];
        await db.from('items').update({ data, title, topic_ids: merged }).eq('id', item.id);
      }
      return info;
    },
  }),
);
