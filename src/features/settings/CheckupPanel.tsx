import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { euro, type PriceRow, type UsageRow } from '../../lib/ai/usage';
import { useAuth } from '../../lib/auth/context';
import type { ContradictionsOutcome } from '../../lib/auth/types';
import { useDb } from '../../lib/db/context';
import { runCheckup, type Finding } from '../../lib/memory/checkup';
import { applyFix, resolveContradiction } from '../../lib/memory/fixes';
import { useSync } from '../../lib/sync/context';

const MONTH_MS = 30 * 86_400_000;
const btn =
  'rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700';
const fixBtn =
  'rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700';

interface Report {
  at: string;
  findings: number;
}

function savingText(f: Finding) {
  if (!f.saving?.words) return null;
  const eur = f.saving.eurPerMonth;
  return `Trims about ${f.saving.words} words from every call${eur > 0 ? ` (≈ ${euro(eur)} a month)` : ''}.`;
}

/**
 * Memory check-up (Task 3.10): free code checks with one-tap fixes, plus an
 * optional one-call "Check for contradictions". With `auto`, it runs by itself
 * when the last check-up is over a month old and shows the last report.
 */
export default function CheckupPanel({ auto = false }: { auto?: boolean }) {
  const db = useDb();
  const navigate = useNavigate();
  const { services } = useAuth();
  const sync = useSync();
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [contra, setContra] = useState<ContradictionsOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  const run = useCallback(async () => {
    let usage: UsageRow[] = [];
    let prices: PriceRow[] = [];
    if (services.usage) {
      const since = new Date(Date.now() - 2 * MONTH_MS).toISOString();
      [usage, prices] = await Promise.all([
        services.usage.monthRows(since).catch(() => []),
        services.usage.prices().catch(() => []),
      ]);
    }
    const status = syncRef.current.status;
    const result = runCheckup({
      facts: await db.memory_facts.toArray(),
      rules: await db.learned_rules.toArray(),
      usage,
      prices,
      pendingSync: status?.pending ?? 0,
      // No server (local mode): nothing to sync, so no sync finding.
      lastSyncedAt: status ? status.lastSyncedAt : new Date().toISOString(),
    });
    const next = { at: new Date().toISOString(), findings: result.length };
    await db.meta.put({ key: 'checkup', value: next });
    setFindings(result);
    setReport(next);
  }, [db, services.usage]);

  // Monthly code-only run (on Insights).
  useEffect(() => {
    if (!auto) return;
    let alive = true;
    // A run cut short by the database closing (sign-out) is simply dropped.
    (async () => {
      const last = (await db.meta.get('checkup'))?.value as Report | undefined;
      if (!alive) return;
      if (!last || Date.now() - Date.parse(last.at) > MONTH_MS) await run();
      else setReport(last);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [auto, db, run]);

  async function onFix(f: Finding) {
    if (!f.fix) return;
    if (f.fix.action === 'open_memory') return void navigate('/settings');
    if (f.fix.action === 'sync_now') await sync.syncNow();
    else await applyFix(db, f.fix);
    setFindings((all) => all?.filter((x) => x.id !== f.id) ?? null);
  }

  async function onContradictions() {
    if (!services.memory) return;
    setBusy(true);
    try {
      setContra(await services.memory.checkContradictions());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => void run().catch(() => {})}>
          Run check-up
        </button>
        {services.memory && (
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => void onContradictions()}
          >
            {busy ? 'Checking…' : 'Check for contradictions (one AI call, ≈ €0.001)'}
          </button>
        )}
      </div>
      {report && (
        <p className="text-xs text-slate-500">
          Last check-up:{' '}
          {new Date(report.at).toDateString() === new Date().toDateString()
            ? 'today'
            : new Date(report.at).toLocaleDateString('en-IE')}{' '}
          · {report.findings} finding{report.findings === 1 ? '' : 's'}
        </p>
      )}

      {findings && findings.length === 0 && (
        <p className="text-sm text-slate-500">All good: nothing to tidy.</p>
      )}
      {findings && findings.length > 0 && (
        <ul aria-label="Check-up findings" className="space-y-2">
          {findings.map((f) => (
            <li key={f.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="font-medium">{f.title}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">{f.detail}</p>
              {savingText(f) && <p className="text-xs text-slate-500">{savingText(f)}</p>}
              {f.fix && (
                <button type="button" className={`${fixBtn} mt-2`} onClick={() => void onFix(f)}>
                  {f.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {contra && (
        <div>
          <p className="text-sm text-slate-500">{contra.message}</p>
          {contra.conflicts.length > 0 && (
            <ContradictionList
              outcome={contra}
              onDone={(i) =>
                setContra((c) => c && { ...c, conflicts: c.conflicts.filter((_, j) => j !== i) })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function ContradictionList({
  outcome,
  onDone,
}: {
  outcome: ContradictionsOutcome;
  onDone: (index: number) => void;
}) {
  const db = useDb();
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void db.memory_facts.toArray().then((all) => {
      if (alive) setTexts(Object.fromEntries(all.map((f) => [f.id, f.text])));
    });
    return () => {
      alive = false;
    };
  }, [db]);

  return (
    <ul aria-label="Contradictions" className="mt-2 space-y-2">
      {outcome.conflicts.map((c, i) => {
        const [a, b] = c.fact_ids;
        return (
          <li
            key={`${a}-${b}`}
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
          >
            <p className="text-sm">
              “{texts[a] ?? '…'}” and “{texts[b] ?? '…'}”
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{c.explanation}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.merged_text && (
                <button
                  type="button"
                  className={fixBtn}
                  onClick={() =>
                    void resolveContradiction(db, a, b, c.merged_text).then(() => onDone(i))
                  }
                >
                  Use “{c.merged_text}”
                </button>
              )}
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
                onClick={() => void resolveContradiction(db, a, b, null).then(() => onDone(i))}
              >
                Keep the first
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
                onClick={() => void resolveContradiction(db, b, a, null).then(() => onDone(i))}
              >
                Keep the second
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
