import { anthropicClient } from '../_shared/anthropic.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { deliver, pusherFromEnv, type DeviceRow, type Pusher } from '../_shared/push.ts';
import { handleTick } from './handler.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { runMorningBrief } from '../morning-brief/run.ts';
import { supabaseBriefStore } from '../morning-brief/store.ts';
import { lastWeekStart, runWeeklyReview } from '../weekly-review/run.ts';
import { supabaseReviewStore } from '../weekly-review/store.ts';
import { runScout } from '../scout/run.ts';
import { supabaseScoutStore } from '../scout/store.ts';
import { runTick, type TickStore } from './tick.ts';
import { drainPlanQueue, type PlanQueueStore } from './plan.ts';
import { runPlanDay } from '../plan-day/run.ts';
import { supabasePlanStore } from '../plan-day/store.ts';
import { planLookups } from '../plan-day/lookups.ts';
import { supabaseHistoryStore } from '../_shared/history/store.ts';
import { gteSmall } from '../_shared/embed.ts';
import { runDayDigests } from '../day-digest/run.ts';
import { supabaseDayDigestStore, supabaseMonthDigestStore } from '../day-digest/store.ts';
import { runMonthDigests } from '../day-digest/month.ts';
import { runPageSummaries } from '../page-summary/run.ts';
import { supabasePageSummaryStore } from '../page-summary/store.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

const store: TickStore = {
  async users() {
    const { data: devices } = await db
      .from('devices')
      .select('user_id')
      .eq('receives_notifications', true)
      .not('push_subscription', 'is', null)
      .is('deleted_at', null);
    const ids = [...new Set((devices ?? []).map((d) => d.user_id as string))];
    if (!ids.length) return [];
    const { data: settings } = await db.from('settings').select('id, data').in('id', ids);
    const byId = new Map(
      (settings ?? []).map((s) => [s.id as string, (s.data ?? {}) as Record<string, unknown>]),
    );
    return ids.map((user_id) => ({ user_id, settings: byId.get(user_id) ?? {} }));
  },
  async due(userId, now) {
    const { data } = await db
      .from('nudges')
      .select('id, kind, send_at, title, body, url')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .lte('send_at', now)
      .is('deleted_at', null)
      .order('send_at')
      .limit(50);
    return data ?? [];
  },
  async sentSince(userId, since) {
    const { count } = await db
      .from('nudges')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent')
      .neq('kind', 'summary')
      .gte('sent_at', since);
    return count ?? 0;
  },
  async lastSummaryAt(userId) {
    const { data } = await db
      .from('nudges')
      .select('sent_at')
      .eq('user_id', userId)
      .eq('kind', 'summary')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.sent_at as string | undefined) ?? null;
  },
  async addNudge(userId, n) {
    await db
      .from('nudges')
      .upsert(
        { user_id: userId, ...n },
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
      );
  },
  async logSent(userId, n) {
    await db.from('nudges').insert({ user_id: userId, ...n, status: 'sent', sent_at: n.send_at });
  },
  async setStatus(ids, status, at) {
    await db
      .from('nudges')
      .update(status === 'sent' ? { status, sent_at: at } : { status })
      .in('id', ids);
  },
  async claimJob(userId, job, localDate) {
    // Insert-if-absent: only the first run for this person, job and local day wins.
    const { data } = await db
      .from('job_runs')
      .upsert(
        { user_id: userId, job, local_date: localDate },
        { onConflict: 'user_id,job,local_date', ignoreDuplicates: true },
      )
      .select('job');
    return (data ?? []).length === 1;
  },
  async openTasks(userId) {
    const { data } = await db
      .from('items')
      .select('id, title, due_at, top3_date, carry_count')
      .eq('user_id', userId)
      .eq('type', 'task')
      .eq('status', 'open')
      .is('deleted_at', null)
      .limit(500);
    return data ?? [];
  },
  async recurringEvents(userId) {
    const { data } = await db
      .from('items')
      .select('id, title, start_at, rrule, data')
      .eq('user_id', userId)
      .eq('type', 'event')
      .eq('status', 'open')
      .eq('all_day', false)
      .not('rrule', 'is', null)
      .not('start_at', 'is', null)
      .is('deleted_at', null)
      .limit(200);
    return data ?? [];
  },
  async leave(userId) {
    const { data } = await db
      .from('leave_bookings')
      .select('start_date, end_date, start_half, end_half, leave_type, status, deleted_at')
      .eq('user_id', userId)
      .is('deleted_at', null);
    return data ?? [];
  },
  async markIgnored() {
    const { data } = await db.rpc('mark_ignored_nudges');
    return Number(data ?? 0);
  },
  async workDays(userId) {
    const { data } = await db
      .from('work_days')
      .select('date, location')
      .eq('user_id', userId)
      .is('deleted_at', null);
    return data ?? [];
  },
};

/** The plan queue (Task 13.3): default nudges for items changed since the last tick. */
const planStore: PlanQueueStore = {
  async queued(limit) {
    const { data } = await db.from('plan_queue').select('item_id').order('queued_at').limit(limit);
    return (data ?? []).map((r) => r.item_id as string);
  },
  async items(ids) {
    const { data } = await db
      .from('items')
      .select(
        'id, user_id, type, title, status, all_day, start_at, due_at, rrule, deleted_at, data',
      )
      .in('id', ids);
    return data ?? [];
  },
  async settings(userId) {
    const { data } = await db.from('settings').select('data').eq('id', userId).maybeSingle();
    return (data?.data ?? {}) as Record<string, unknown>;
  },
  async prep(itemId) {
    const { data } = await db.from('item_plans').select('prep').eq('item_id', itemId).maybeSingle();
    return Array.isArray(data?.prep) ? (data.prep as string[]) : [];
  },
  async pendingKeys(userId, itemId) {
    const { data } = await db
      .from('nudges')
      .select('dedupe_key, source')
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .eq('status', 'pending')
      .like('dedupe_key', 'plan:%');
    return (data ?? []).map((r) => ({ key: r.dedupe_key as string, source: r.source as string }));
  },
  async upsert(userId, n) {
    const { error } = await db.rpc('upsert_plan_nudge', {
      p_user_id: userId,
      p_key: n.key,
      p_kind: n.kind,
      p_item_id: n.item_id,
      p_send_at: n.send_at,
      p_title: n.title,
      p_body: n.body,
      p_url: n.url,
      p_reason: n.reason,
      p_source: 'default',
    });
    if (error) throw new Error(error.message);
  },
  async cancel(userId, key) {
    await db.rpc('cancel_nudge', { p_user_id: userId, p_key: key });
  },
  async dequeue(ids) {
    await db.from('plan_queue').delete().in('item_id', ids);
  },
};

/** POST /scheduler-tick (service key only): see handler.ts. */
Deno.serve((req) =>
  handleTick(req, {
    caller: supabaseCaller(db, isService),
    pusher: () => pusherFromEnv(),
    tick: (pusher) => tickNow(pusher),
    // Defaults for changed items (Task 13.3) and code-built pages (Task 14.3); neither stops the other.
    plan: async () => {
      const [plan, pages] = await Promise.allSettled([
        drainPlanQueue(new Date(), planStore),
        db.rpc('drain_page_queue'),
      ]);
      return {
        plan: plan.status === 'fulfilled' ? plan.value : { failed: true },
        pages: pages.status === 'fulfilled' ? (pages.value.data ?? 0) : { failed: true },
      };
    },
  }),
);

function tickNow(pusher: Pusher) {
  return runTick(
    new Date(),
    store,
    async (userId, payload) => {
      const { data } = await db
        .from('devices')
        .select('id, user_id, push_subscription, receives_notifications')
        .eq('user_id', userId)
        .eq('receives_notifications', true)
        .is('deleted_at', null);
      const res = await deliver((data ?? []) as DeviceRow[], payload, pusher, async (id) => {
        await db.from('devices').update({ push_subscription: null }).eq('id', id);
      });
      return res.sent > 0 ? 'sent' : 'none';
    },
    {
      brief: async (userId, localDate, at) => {
        await runMorningBrief(
          userId,
          localDate,
          at,
          {
            store: supabaseBriefStore(db),
            ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
            usage: supabaseUsageStore(db),
          },
          { roundUp: true },
        );
      },
      plan: async (userId, localDate, at) => {
        await runPlanDay(userId, localDate, at, 'evening', {
          store: supabasePlanStore(db),
          ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
          usage: supabaseUsageStore(db),
          lookups: planLookups(
            supabaseHistoryStore(db, (t) => gteSmall(t).catch(() => null)),
            userId,
          ),
        });
      },
      dayDigest: async (userId, localDate) => {
        await runDayDigests(userId, localDate, {
          store: supabaseDayDigestStore(db),
          ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
          usage: supabaseUsageStore(db),
        });
      },
      monthDigest: async (userId, localDate) => {
        await runMonthDigests(userId, localDate, {
          store: supabaseMonthDigestStore(db),
          ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
          usage: supabaseUsageStore(db),
        });
      },
      pageSummaries: async (userId) => {
        await runPageSummaries(userId, {
          store: supabasePageSummaryStore(db, userId),
          ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
          usage: supabaseUsageStore(db),
        });
      },
      planMorning: async (userId, localDate, at) => {
        await runPlanDay(userId, localDate, at, 'morning', {
          store: supabasePlanStore(db),
          ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
          usage: supabaseUsageStore(db),
          lookups: planLookups(
            supabaseHistoryStore(db, (t) => gteSmall(t).catch(() => null)),
            userId,
          ),
        });
      },
      planFallback: async (userId, localDate) => {
        // No successful evening run: record that the defaults carried the day (Insights).
        const { data } = await db
          .from('plan_runs')
          .select('id')
          .eq('user_id', userId)
          .eq('local_date', localDate)
          .eq('kind', 'evening')
          .eq('status', 'ok')
          .limit(1);
        if ((data ?? []).length) return;
        await db.from('plan_runs').insert({
          user_id: userId,
          kind: 'defaults',
          local_date: localDate,
          status: 'ok',
          finished_at: new Date().toISOString(),
          summary: { why: 'no planner run succeeded; the defaults stand' },
        });
      },
      review: async (userId, localDate) => {
        await runWeeklyReview(
          userId,
          lastWeekStart(localDate),
          {
            store: supabaseReviewStore(db),
            ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
            usage: supabaseUsageStore(db),
          },
          { notify: true },
        );
        // Scout runs weekly alongside the review, unless switched off (Task 8.11).
        const { data } = await db.from('settings').select('data').eq('id', userId).maybeSingle();
        const scout = ((data?.data as Record<string, unknown> | undefined)?.scout ?? {}) as {
          enabled?: boolean;
        };
        if (scout.enabled !== false)
          await runScout(userId, 'weekly', {
            store: supabaseScoutStore(db),
            ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
            usage: supabaseUsageStore(db),
          }).catch(() => undefined);
      },
    },
  );
}
