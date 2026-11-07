import { useState } from 'react';
import { useDb } from '../../lib/db/context';
import { downloadExport } from '../../lib/export/export';

export default function ExportSettings() {
  const db = useDb();
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');

  async function onExport() {
    setState('working');
    try {
      await downloadExport(db);
      setState('done');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          A zip of everything on this device: Markdown files you can read anywhere, a full JSON
          backup and your photos.
        </p>
        <button
          type="button"
          disabled={state === 'working'}
          onClick={() => void onExport()}
          className="shrink-0 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700"
        >
          Export everything
        </button>
      </div>
      <p role="status" className="text-sm text-slate-500">
        {state === 'working' && 'Preparing your export…'}
        {state === 'done' && 'Export downloaded.'}
        {state === 'error' && 'The export could not be created. Try again.'}
      </p>
    </div>
  );
}
