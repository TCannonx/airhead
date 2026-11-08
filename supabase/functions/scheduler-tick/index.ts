import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { json } from '../_shared/http.ts';
import { isServiceToken, SERVICE_KEYS } from '../_shared/serviceAuth.ts';
import { deliver, pusherFromEnv, type DeviceRow } from '../_shared/push.ts';
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { runMorningBrief } from '../morning-brief/run.ts';
import { supabaseBriefStore } from '../morning-brief/store.ts';
import { lastWeekStart, runWeeklyReview } from '../weekly-review/run.ts';
import { supabaseReviewStore } from '../weekly-review/store.ts';
import { runScout } from '../scout/run.ts';
import { supabaseScoutStore } from '../scout/store.ts';
import { runTick, type TickStore } from './tick.ts';

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
  async workDays(userId) {
    const { data } = await db
      .from('work_days')
      .select('date, location')
      .eq('user_id', userId)
      .is('deleted_at', null);
    return data ?? [];
  },
};

/**
 * POST /scheduler-tick (service key only; pg_cron calls it every minute).
 * Plans recurring reminders, runs local-time jobs once a day, sends due nudges.
 */
Deno.serve(async (req) => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!isServiceToken(token, SERVICE_KEYS)) {
    return json({ ok: false, error_code: 'unauthorized', message: 'Scheduler only.' }, 401);
  }
  const pusher = await pusherFromEnv().catch(() => null);
  if (!pusher) {
    return json({ ok: false, error_code: 'not_configured', message: 'Push is not set up.' }, 200);
  }
  const report = await runTick(
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
            ai: new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || 'missing' }),
            usage: supabaseUsageStore(db),
          },
          { roundUp: true },
        );
      },
      review: async (userId, localDate) => {
        await runWeeklyReview(
          userId,
          lastWeekStart(localDate),
          {
            store: supabaseReviewStore(db),
            ai: new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || 'missing' }),
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
            ai: new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || 'missing' }),
            usage: supabaseUsageStore(db),
          }).catch(() => undefined);
      },
    },
  );
  return json({ ok: true, error_code: null, message: 'ok', ...report });
});
