import { useState } from 'react';
import { useDb } from '../../lib/db/context';
import { downloadExport } from '../../lib/export/export';
import { Button } from '../../ui/Button';

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
        <p className="text-footnote text-fg-muted">
          A zip of everything on this device: Markdown files you can read anywhere, a full JSON
          backup and your photos.
        </p>
        <Button disabled={state === 'working'} onClick={() => void onExport()}>
          Export everything
        </Button>
      </div>
      <p role="status" className="text-footnote text-fg-muted">
        {state === 'working' && 'Preparing your export…'}
        {state === 'done' && 'Export downloaded.'}
        {state === 'error' && 'The export could not be created. Try again.'}
      </p>
    </div>
  );
}
