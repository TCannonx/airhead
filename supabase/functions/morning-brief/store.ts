import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { buildProfile, type FactRow } from '../_shared/memory.ts';
import type { Digest, PlanForBrief } from './brief.ts';
import type { BriefStore } from './run.ts';

/** The brief's database access, with the service key (always filtered to one person). */
export function supabaseBriefStore(db: SupabaseClient): BriefStore {
  return {
    async digest(userId, localDate) {
      const { data, error } = await db.rpc('morning_digest', {
        p_user_id: userId,
        p_local_date: localDate,
      });
      if (error) throw new Error(`digest: ${error.message}`);
      return data as Digest;
    },
    async settings(userId) {
      const { data } = await db.from('settings').select('data').eq('id', userId).maybeSingle();
      return (data?.data ?? {}) as Record<string, unknown>;
    },
    async profile(userId) {
      const { data } = await db
        .from('memory_facts')
        .select('id, text, last_used_at, created_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null);
      return buildProfile((data ?? []) as FactRow[]).text;
    },
    async recentWeeks(userId, n) {
      const { data } = await db
        .from('reviews')
        .select('week_start, digest')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .not('digest', 'is', null)
        .order('week_start', { ascending: false })
        .limit(n);
      return (data ?? []) as { week_start: string; digest: string }[];
    },
    async saveBrief(userId, localDate, b) {
      const { error } = await db.from('briefs').upsert(
        {
          user_id: userId,
          local_date: localDate,
          status: b.status,
          content: b.content,
          model: b.model,
          cost_eur: b.cost_eur,
          deleted_at: null,
        },
        { onConflict: 'user_id,local_date' },
      );
      if (error) throw new Error(`save brief: ${error.message}`);
    },
    async setTop3(userId, ids, localDate) {
      if (ids.length)
        await db.from('items').update({ top3_date: localDate }).eq('user_id', userId).in('id', ids);
    },
    async plan(userId, localDate) {
      const yesterday = new Date(Date.parse(`${localDate}T12:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      const { data: runs } = await db
        .from('plan_runs')
        .select('kind, local_date, summary, finished_at')
        .eq('user_id', userId)
        .eq('status', 'ok')
        .in('kind', ['evening', 'morning'])
        .in('local_date', [yesterday, localDate])
        .order('finished_at', { ascending: false });
      const relevant = (runs ?? []).filter(
        (r) =>
          (r.kind === 'evening' && r.local_date === yesterday) ||
          (r.kind === 'morning' && r.local_date === localDate),
      );
      if (!relevant.length) return null;
      const summaries = relevant.map((r) => (r.summary ?? {}) as Record<string, unknown>);
      const evening = summaries[summaries.length - 1] ?? {};
      const num = (v: unknown) => (typeof v === 'number' ? v : 0);
      const dayStart = new Date(`${localDate}T00:00:00Z`).toISOString();
      const dayEnd = new Date(Date.parse(dayStart) + 86_400_000 + 3_600_000).toISOString();
      const [{ data: prepare }, { data: surfacing }, { data: reading }] = await Promise.all([
        db
          .from('nudges')
          .select('title, send_at')
          .eq('user_id', userId)
          .eq('kind', 'prepare')
          .in('status', ['pending', 'sent'])
          .gte('send_at', dayStart)
          .lt('send_at', dayEnd)
          .order('send_at'),
        db
          .from('item_plans')
          .select('item_id, surface_at')
          .eq('user_id', userId)
          .gte('surface_at', dayStart)
          .lt('surface_at', dayEnd)
          .is('deleted_at', null),
        db
          .from('items')
          .select('id, title')
          .eq('user_id', userId)
          .eq('type', 'reading')
          .eq('status', 'open')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const surfIds = (surfacing ?? []).map((s) => s.item_id as string);
      const { data: surfItems } = surfIds.length
        ? await db.from('items').select('id, title').in('id', surfIds).is('deleted_at', null)
        : { data: [] };
      const plan: PlanForBrief = {
        left_out: num(evening.left_out),
        dropped: summaries.reduce(
          (n, s) => n + (Array.isArray(s.dropped) ? s.dropped.length : 0),
          0,
        ),
        clashes: summaries.flatMap((s) =>
          Array.isArray(s.clashes) ? (s.clashes as { note: string }[]) : [],
        ),
        prepare_now: (prepare ?? []).map((n) => n.title as string),
        surfacing: (surfItems ?? []).map((i) => ({
          item_id: i.id as string,
          title: i.title as string,
        })),
        reading: reading ? { item_id: reading.id as string, title: reading.title as string } : null,
      };
      return plan;
    },
    async planPrepared(userId, itemIds, localDate) {
      const { data } = await db
        .from('nudges')
        .select('item_id')
        .eq('user_id', userId)
        .in('status', ['pending', 'sent', 'bundled'])
        .in(
          'dedupe_key',
          itemIds.map((id) => `plan:prepare:${id}:${localDate}`),
        );
      return new Set((data ?? []).map((r) => r.item_id as string));
    },
    async cancelPrep(userId, localDate) {
      await db
        .from('nudges')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .eq('kind', 'prep')
        .eq('status', 'pending')
        .like('dedupe_key', `prep:${localDate}:%`);
    },
    async addNudge(userId, n) {
      await db
        .from('nudges')
        .upsert(
          { user_id: userId, ...n },
          { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
        );
    },
  };
}
