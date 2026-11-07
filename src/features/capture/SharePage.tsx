import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { sharedText } from '../../lib/capture/bookmarklet';
import { createCapture } from '../../lib/db/captures';
import { useDb } from '../../lib/db/context';

const HTTP = /^https?:\/\//i;

/**
 * /share (Task 7.4): where the bookmarklet and the PWA share target land. The
 * page's address, title and selection are saved once as a capture (offline
 * too), then the little window closes itself.
 */
export default function SharePage({ closeDelayMs = 1200 }: { closeDelayMs?: number }) {
  const db = useDb();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const done = useRef(false);
  const [saved, setSaved] = useState(false);
  const url = params.get('url')?.trim() ?? '';
  const text = sharedText({ title: params.get('title'), text: params.get('text') });
  const empty = !url && !text;

  useEffect(() => {
    if (done.current || !user || empty) return;
    done.current = true;
    void createCapture(db, user.id, { text: text || null, url: HTTP.test(url) ? url : null }).then(
      () => {
        setSaved(true);
        if (window.opener) window.setTimeout(() => window.close(), closeDelayMs);
      },
    );
  }, [db, user, url, text, empty, closeDelayMs]);
  const state = empty ? 'empty' : saved ? 'saved' : 'saving';

  return (
    <Page title="Send to Airhead">
      <p role="status" className="text-lg">
        {state === 'saving'
          ? 'Saving…'
          : state === 'saved'
            ? 'Saved to Airhead.'
            : 'Nothing to save: no page address or text came with this.'}
      </p>
    </Page>
  );
}
