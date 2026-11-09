import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
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

      // Update the reading item the free rules created for this link.
      const { data: items } = await db
        .from('items')
        .select('id, title, data')
        .eq('capture_id', capture.id)
        .eq('type', 'reading');
      for (const item of items ?? []) {
        const data = {
          ...(item.data as Record<string, unknown>),
          description: info.description,
          reading_minutes: info.reading_minutes,
          couldnt_read: info.status === 'unreadable',
        };
        const title = item.title === capture.url && info.title ? info.title : item.title;
        await db.from('items').update({ data, title }).eq('id', item.id);
      }
      return info;
    },
  }),
);
