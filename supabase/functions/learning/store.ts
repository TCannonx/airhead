import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { LivePref, Outcome, TimingStore } from './timing.ts';

/** The timing pass's database access, with the service key (always one person). */
export function supabaseTimingStore(db: SupabaseClient): TimingStore {
  return {
    async outcomes(userId) {
      const since = new Date(Date.now() - 56 * 86_400_000).toISOString();
      const { data: nudges } = await db
        .from('nudges')
        .select('kind, item_id, outcome, send_at, snoozed_to, outcome_at')
        .eq('user_id', userId)
        .not('outcome', 'is', null)
        .in('kind', ['prepare', 'leave', 'do', 'follow_up', 'reading'])
        .gte('send_at', since)
        .order('outcome_at')
        .limit(1000);
      const rows = (nudges ?? []) as {
        kind: string;
        item_id: string | null;
        outcome: Outcome['outcome'];
        send_at: string;
        snoozed_to: string | null;
        outcome_at: string | null;
      }[];
      const itemIds = [...new Set(rows.map((r) => r.item_id).filter((x): x is string => !!x))];
      const pageOf = new Map<string, { id: string; name: string }>();
      if (itemIds.length) {
        const { data: links } = await db
          .from('page_items')
          .select('item_id, pages!inner(id, name, kind, status)')
          .in('item_id', itemIds)
          .is('deleted_at', null);
        for (const l of (links ?? []) as unknown as {
          item_id: string;
          pages: { id: string; name: string; kind: string; status: string };
        }[]) {
          if (['series', 'place', 'person'].includes(l.pages.kind) && !pageOf.has(l.item_id))
            pageOf.set(l.item_id, { id: l.pages.id, name: l.pages.name });
        }
      }
      return rows.map((r) => {
        const page = r.item_id ? pageOf.get(r.item_id) : undefined;
        return {
          kind: r.kind,
          page_id: page?.id ?? null,
          page_name: page?.name ?? null,
          outcome: r.outcome,
          send_at: r.send_at,
          snoozed_to: r.snoozed_to,
          outcome_at: r.outcome_at ?? r.send_at,
        };
      });
    },
    async live(userId) {
      const { data } = await db
        .from('timing_prefs')
        .select('id, kind, page_id, direction, fact_id, contradictions, checked_until')
        .eq('user_id', userId)
        .eq('archived', false);
      return (data ?? []) as LivePref[];
    },
    async learn(userId, p, fact) {
      // The memory path: an everyday fact is active at once and shown in Settings -> Memory.
      const { data: f, error } = await db
        .from('memory_facts')
        .insert({ user_id: userId, text: fact, category: 'everyday', status: 'active' })
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`save fact: ${error.message}`);
      await db.from('timing_prefs').insert({
        user_id: userId,
        kind: p.kind,
        page_id: p.page_id,
        direction: p.direction,
        shift_minutes: p.shift_minutes,
        fact_id: f?.id ?? null,
      });
    },
    async contradict(pref, count, until, archive) {
      await db
        .from('timing_prefs')
        .update({ contradictions: count, checked_until: until, archived: archive })
        .eq('id', pref.id);
      if (archive && pref.fact_id)
        await db
          .from('memory_facts')
          .update({ status: 'archived', updated_at: until })
          .eq('id', pref.fact_id);
    },
  };
}
