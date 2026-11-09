import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { handleEmbed } from './handler.ts';
import { runEmbed } from './run.ts';
import { itemParts } from './text.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

// Supabase's built-in embedding model (Edge Runtime global): 384 dimensions.
declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, opts: Record<string, unknown>): Promise<unknown>;
    };
  };
};
let session: { run(input: string, opts: Record<string, unknown>): Promise<unknown> } | null = null;
async function embed(text: string): Promise<number[]> {
  session ??= new Supabase.ai.Session('gte-small');
  return (await session.run(text, { mean_pool: true, normalize: true })) as number[];
}

/** POST /embed-items (service only): see handler.ts. */
Deno.serve((req) =>
  handleEmbed(req, {
    caller: supabaseCaller(db, isService),
    embed: () => runEmbedNow(),
  }),
);

function runEmbedNow() {
  return runEmbed({
    async take(limit) {
      const { data, error } = await db.rpc('take_embed_queue', { p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as { item_id: string; user_id: string }[];
    },
    async load(itemId, userId) {
      const { data: item } = await db
        .from('items')
        .select('id, user_id, title, body, data, deleted_at, status')
        .eq('id', itemId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!item) return null;
      const { data: noteDoc } = await db
        .from('note_docs')
        .select('kind, doc')
        .eq('id', itemId)
        .is('deleted_at', null)
        .maybeSingle();
      const { data: draft } = await db
        .from('drafts')
        .select('content')
        .eq('item_id', itemId)
        .is('deleted_at', null)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        id: item.id,
        user_id: item.user_id,
        title: item.title ?? '',
        deleted: !!item.deleted_at || item.status === 'dropped',
        parts: itemParts({
          body: item.body,
          data: (item.data ?? {}) as Record<string, unknown>,
          noteDoc,
          draft: (draft?.content as Record<string, unknown> | undefined) ?? null,
        }),
      };
    },
    async existing(itemId) {
      const { data } = await db
        .from('chunks')
        .select('chunk_index, content_hash')
        .eq('item_id', itemId);
      return data ?? [];
    },
    async upsert(chunks) {
      const { error } = await db.from('chunks').upsert(
        chunks.map((c) => ({
          ...c,
          embedding: JSON.stringify(c.embedding),
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'item_id,chunk_index' },
      );
      if (error) throw new Error(error.message);
    },
    async removeFrom(itemId, fromIndex) {
      await db.from('chunks').delete().eq('item_id', itemId).gte('chunk_index', fromIndex);
    },
    embed,
    async factsToEmbed(limit) {
      const { data, error } = await db.rpc('facts_to_embed', { p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; text: string }[];
    },
    async storeFact(id, embedding) {
      const { error } = await db.rpc('store_fact_embedding', {
        p_fact: id,
        p_embedding: JSON.stringify(embedding),
      });
      if (error) throw new Error(error.message);
    },
  });
}
