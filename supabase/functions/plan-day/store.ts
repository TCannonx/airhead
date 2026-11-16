import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { buildProfile, type FactRow } from '../_shared/memory.ts';
import type { RawPlanDigest } from './digest.ts';
import type { PlanStore } from './run.ts';

/** The planner's database access, with the service key (always filtered to one person). */
export function supabasePlanStore(db: SupabaseClient): PlanStore {
  return {
    async startRun(userId, kind, localDate) {
      const { data, error } = await db
        .from('plan_runs')
        .insert({ user_id: userId, kind, local_date: localDate })
        .select('id')
        .maybeSingle();
      if (error) {
        if (error.code === '23505') return null; // already ran today
        throw new Error(`start run: ${error.message}`);
      }
      return (data?.id as string | undefined) ?? null;
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
    async digest(userId, localDate) {
      const { data, error } = await db.rpc('plan_digest', {
        p_user_id: userId,
        p_local_date: localDate,
      });
      if (error) throw new Error(`digest: ${error.message}`);
      return data as RawPlanDigest;
    },
    async history(userId, localDate) {
      const [days, weeks, month] = await Promise.all([
        db
          .from('day_digests')
          .select('local_date, digest')
          .eq('user_id', userId)
          .lte('local_date', localDate)
          .is('deleted_at', null)
          .order('local_date', { ascending: false })
          .limit(3),
        db
          .from('reviews')
          .select('week_start, digest')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .not('digest', 'is', null)
          .order('week_start', { ascending: false })
          .limit(2),
        db
          .from('month_digests')
          .select('month, digest')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('month', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        days: (days.data ?? []).map((d) => ({
          date: d.local_date as string,
          digest: d.digest as string,
        })),
        weeks: (weeks.data ?? []).map((w) => ({
          week_start: w.week_start as string,
          digest: w.digest as string,
        })),
        month: month.data
          ? { month: month.data.month as string, digest: month.data.digest as string }
          : null,
      };
    },
    async eveningFinishedAt(userId, eveningDate) {
      const { data } = await db
        .from('plan_runs')
        .select('finished_at')
        .eq('user_id', userId)
        .eq('kind', 'evening')
        .eq('local_date', eveningDate)
        .eq('status', 'ok')
        .maybeSingle();
      return (data?.finished_at as string | null | undefined) ?? null;
    },
    async reading(userId) {
      const [{ data: items }, { data: topics }] = await Promise.all([
        db
          .from('items')
          .select('id, title, data, topic_ids, created_at')
          .eq('user_id', userId)
          .eq('type', 'reading')
          .eq('status', 'open')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(60),
        db
          .from('topics')
          .select('id, name')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .limit(500),
      ]);
      const names = new Map((topics ?? []).map((t) => [t.id as string, t.name as string]));
      const rows = (items ?? []) as {
        id: string;
        title: string;
        data: Record<string, unknown>;
        topic_ids: string[];
        created_at: string;
      }[];
      const byTopic = new Map<string, { count: number; last: string }>();
      for (const r of rows)
        for (const t of r.topic_ids ?? []) {
          const cur = byTopic.get(t);
          byTopic.set(t, {
            count: (cur?.count ?? 0) + 1,
            last: cur && cur.last > r.created_at ? cur.last : r.created_at,
          });
        }
      const minutesOf = (d: Record<string, unknown>) => {
        const link = d.link as { minutes?: unknown } | undefined;
        const m = link?.minutes ?? d.reading_minutes;
        return typeof m === 'number' ? m : null;
      };
      return {
        topics: [...byTopic.entries()]
          .filter(([, v]) => v.count >= 3)
          .sort((a, b) => b[1].last.localeCompare(a[1].last))
          .map(([id, v]) => ({
            name: names.get(id) ?? '',
            count: v.count,
            last_added: v.last.slice(0, 10),
          }))
          .filter((t) => t.name),
        unread: rows
          .filter((r) => (r.data.link as { status?: string } | undefined)?.status !== 'unreadable')
          .slice(0, 8)
          .map((r) => ({
            item_id: r.id,
            title: r.title,
            minutes: minutesOf(r.data),
            topics: (r.topic_ids ?? []).map((t) => names.get(t) ?? '').filter(Boolean),
          })),
      };
    },
    async spentToday(userId, localDate) {
      const { data } = await db
        .from('plan_runs')
        .select('cost_eur')
        .eq('user_id', userId)
        .eq('local_date', localDate);
      return (data ?? []).reduce((sum, r) => sum + Number(r.cost_eur ?? 0), 0);
    },
    async apply(runId, payload) {
      const { data, error } = await db.rpc('apply_plan', { p_run_id: runId, p_payload: payload });
      if (error) throw new Error(`apply: ${error.message}`);
      if (payload.lookups_used)
        await db.from('plan_runs').update({ lookups_used: payload.lookups_used }).eq('id', runId);
      return Number(data ?? 0);
    },
    async finish(runId, status, fields) {
      await db
        .from('plan_runs')
        .update({
          status,
          finished_at: new Date().toISOString(),
          ...(fields.items_considered !== undefined
            ? { items_considered: fields.items_considered }
            : {}),
          ...(fields.cost_eur !== undefined ? { cost_eur: fields.cost_eur } : {}),
          ...(fields.error !== undefined ? { error: fields.error } : {}),
          ...(fields.summary !== undefined ? { summary: fields.summary } : {}),
        })
        .eq('id', runId);
    },
  };
}
