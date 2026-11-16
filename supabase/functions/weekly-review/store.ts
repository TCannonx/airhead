import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { Candidate, FactIn } from './review.ts';
import type { ReviewStore } from './run.ts';

const DAY = 86_400_000;

/** The review's database access, with the service key (always filtered to one person). */
export function supabaseReviewStore(db: SupabaseClient): ReviewStore {
  return {
    async digest(userId, weekStart) {
      const { data, error } = await db.rpc('weekly_digest', {
        p_user_id: userId,
        p_week_start: weekStart,
      });
      if (error) throw new Error(`digest: ${error.message}`);
      return data as Record<string, unknown>;
    },
    async pastDigests(userId, before, n) {
      const { data } = await db
        .from('reviews')
        .select('week_start, digest')
        .eq('user_id', userId)
        .lt('week_start', before)
        .is('deleted_at', null)
        .order('week_start', { ascending: false })
        .limit(n);
      return (data ?? []).filter((r) => r.digest) as { week_start: string; digest: string }[];
    },
    async candidates(userId) {
      const { data, error } = await db.rpc('tidy_candidates', { p_user_id: userId });
      if (error) throw new Error(`candidates: ${error.message}`);
      return (data ?? []) as Candidate[];
    },
    async facts(userId) {
      const { data } = await db
        .from('memory_facts')
        .select('id, text, last_used_at, created_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('last_used_at', { ascending: true, nullsFirst: true })
        .limit(40);
      const now = Date.now();
      return (data ?? []).map((f) => ({
        id: f.id as string,
        text: f.text as string,
        unused_days: Math.floor(
          (now - new Date((f.last_used_at ?? f.created_at) as string).getTime()) / DAY,
        ),
      })) as FactIn[];
    },
    async softDelete(userId, kind, ids) {
      await db
        .from(kind === 'item' ? 'items' : 'captures')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('id', ids)
        .is('deleted_at', null);
    },
    async planner(userId, weekStart) {
      const end = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const next = new Date(Date.parse(`${end}T00:00:00Z`) + 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const [runs, nudges, slipped, events, tasks] = await Promise.all([
        db
          .from('plan_runs')
          .select('kind, status, cost_eur')
          .eq('user_id', userId)
          .gte('local_date', weekStart)
          .lt('local_date', end),
        db
          .from('nudges')
          .select('outcome')
          .eq('user_id', userId)
          .not('outcome', 'is', null)
          .gte('send_at', weekStart)
          .lt('send_at', end),
        db
          .from('items')
          .select('id, title, due_at, carry_count')
          .eq('user_id', userId)
          .eq('type', 'task')
          .eq('status', 'open')
          .is('deleted_at', null)
          .lt('due_at', end)
          .order('carry_count', { ascending: false })
          .limit(15),
        db
          .from('items')
          .select('start_at, end_at, all_day')
          .eq('user_id', userId)
          .eq('type', 'event')
          .eq('status', 'open')
          .is('deleted_at', null)
          .gte('start_at', end)
          .lt('start_at', next)
          .limit(200),
        db
          .from('items')
          .select('id, title, due_at')
          .eq('user_id', userId)
          .eq('type', 'task')
          .eq('status', 'open')
          .is('deleted_at', null)
          .gte('due_at', end)
          .lt('due_at', next)
          .limit(30),
      ]);
      const ids = [...(slipped.data ?? []), ...(tasks.data ?? [])].map((t) => t.id as string);
      const { data: plans } = ids.length
        ? await db.from('item_plans').select('item_id, reason, effort_minutes').in('item_id', ids)
        : { data: [] };
      const planOf = new Map((plans ?? []).map((p) => [p.item_id as string, p]));
      const byKind = new Map<
        string,
        { kind: string; ok: number; failed: number; capped: number; cost_eur: number }
      >();
      for (const r of runs.data ?? []) {
        const k = r.kind as string;
        const row = byKind.get(k) ?? { kind: k, ok: 0, failed: 0, capped: 0, cost_eur: 0 };
        if (r.status === 'ok') row.ok++;
        if (r.status === 'failed') row.failed++;
        if (r.status === 'cap_reached') row.capped++;
        row.cost_eur += Number(r.cost_eur ?? 0);
        byKind.set(k, row);
      }
      const count = (o: string) => (nudges.data ?? []).filter((n) => n.outcome === o).length;
      // Free time per day from a 08:00-21:00 window minus timed events (the calendar gap idea, in minutes).
      const days = Array.from({ length: 7 }, (_, i) =>
        new Date(Date.parse(`${end}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      ).map((date) => {
        const todays = (events.data ?? []).filter((e) => String(e.start_at).slice(0, 10) === date);
        const busy = todays
          .filter((e) => !e.all_day && e.end_at)
          .reduce(
            (m, e) =>
              m + (Date.parse(e.end_at as string) - Date.parse(e.start_at as string)) / 60_000,
            0,
          );
        return {
          date,
          commitments: todays.length,
          busy_minutes: Math.round(busy),
          free_minutes: Math.max(0, 13 * 60 - Math.round(busy)),
        };
      });
      return {
        runs: [...byKind.values()],
        outcomes: {
          acted: count('acted'),
          snoozed: count('snoozed'),
          dismissed: count('dismissed'),
          ignored: count('ignored'),
        },
        slipped: (slipped.data ?? []).map((t) => ({
          id: t.id as string,
          title: t.title as string,
          due: (t.due_at as string | null)?.slice(0, 10) ?? null,
          carry_count: Number(t.carry_count ?? 0),
          plan: (planOf.get(t.id as string)?.reason as string | undefined) ?? null,
        })),
        next_week: {
          days,
          tasks: (tasks.data ?? []).map((t) => ({
            id: t.id as string,
            title: t.title as string,
            due: (t.due_at as string | null)?.slice(0, 10) ?? null,
            effort_minutes:
              (planOf.get(t.id as string)?.effort_minutes as number | null | undefined) ?? null,
          })),
        },
      };
    },
    async propose(userId, weekStart, proposals) {
      const ids = proposals.map((p) => p.item_id);
      const { data: items } = await db
        .from('items')
        .select('id, status, due_at, body, updated_at')
        .eq('user_id', userId)
        .in('id', ids);
      const byId = new Map((items ?? []).map((i) => [i.id as string, i]));
      const rows = proposals.flatMap((p) => {
        const it = byId.get(p.item_id);
        if (!it) return [];
        const before =
          p.kind === 'move'
            ? { due_at: it.due_at }
            : p.kind === 'drop'
              ? { status: it.status }
              : { body: it.body };
        const after =
          p.kind === 'move'
            ? { due_at: `${p.when}T09:00:00.000Z` }
            : p.kind === 'drop'
              ? { status: 'dropped' }
              : {
                  body: [String(it.body ?? '').trim(), p.steps.map((s) => `- [ ] ${s}`).join('\n')]
                    .filter(Boolean)
                    .join('\n\n'),
                };
        return [
          {
            user_id: userId,
            capture_id: null,
            kind:
              p.kind === 'move'
                ? 'reschedule_item'
                : p.kind === 'drop'
                  ? 'drop_item'
                  : 'split_task',
            status: 'proposed',
            reason: `Weekly review ${weekStart}`,
            summary:
              p.kind === 'move'
                ? `Move "${p.title}" to ${p.when}`
                : p.kind === 'drop'
                  ? `Drop "${p.title}"`
                  : `Split "${p.title}" into ${p.steps.length} steps`,
            quote: p.reason,
            confidence: null,
            payload: { source: 'weekly_review', week_start: weekStart },
            target_table: 'items',
            target_id: p.item_id,
            before,
            after,
          },
        ];
      });
      if (rows.length) await db.from('ai_actions').insert(rows);
    },
    async saveReview(userId, weekStart, r) {
      const { error } = await db.from('reviews').upsert(
        {
          user_id: userId,
          week_start: weekStart,
          status: r.status,
          content: r.content,
          digest: r.digest,
          cost_eur: r.cost_eur,
          deleted_at: null,
        },
        { onConflict: 'user_id,week_start' },
      );
      if (error) throw new Error(`save review: ${error.message}`);
    },
    async addNudge(userId, n) {
      await db.from('nudges').upsert(
        {
          user_id: userId,
          kind: 'weekly_review',
          item_id: null,
          send_at: new Date().toISOString(),
          title: n.title,
          body: n.body,
          url: n.url,
          dedupe_key: n.dedupe_key,
        },
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
      );
    },
  };
}
