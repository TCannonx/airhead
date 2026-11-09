import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import {
  feedUrl,
  issueFeedToken,
  revokeFeed,
  webcalUrl,
  type OutgoingKind,
} from '../../lib/db/feeds';
import { Button } from '../../ui/Button';

const small = 'rounded-lg px-3 py-1.5 text-footnote font-semibold hover:bg-fill';

const KINDS: { kind: OutgoingKind; title: string; text: string }[] = [
  {
    kind: 'us_out',
    title: 'Us calendar',
    text: 'Us events, leave you share and where you work each day (as set in Work). Send the link to your partner to subscribe in Apple or Google Calendar. It updates every hour or so (Google can take longer).',
  },
  {
    kind: 'me_out',
    title: 'My own phone',
    text: 'Everything in Airhead (Personal, Us, time blocks, leave, locations), to subscribe in your phone’s calendar app.',
  },
];

function FeedRow({
  kind,
  title,
  text,
  canPublish,
}: {
  kind: OutgoingKind;
  title: string;
  text: string;
  canPublish: boolean;
}) {
  const db = useDb();
  const { user } = useAuth();
  const feed = useLiveQuery(
    async () => (await db.feeds.where('kind').equals(kind).toArray()).find((f) => !f.deleted_at),
    [db, kind],
  );
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    const { token } = await issueFeedToken(db, user?.id ?? '', kind);
    setShown(feedUrl(token));
    setCopied(false);
  }

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <h3 className="text-footnote font-medium">{title}</h3>
      <p className="mb-2 text-footnote text-fg-muted">{text}</p>
      {!canPublish ? (
        <p className="text-footnote text-fg-muted">
          Needs a server: links work once sync is set up.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {feed ? (
            <>
              <span className="text-footnote text-fg-muted">Link is on.</span>
              <Button size="sm" onClick={() => void issue()}>
                New link
              </Button>
              <Button
                variant="destructive"
                size="sm"

                onClick={() => {
                  setShown(null);
                  void revokeFeed(db, feed.id);
                }}
              >
                Turn off
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={() => void issue()}>
              Create link
            </Button>
          )}
        </div>
      )}
      {shown && (
        <div className="mt-2 rounded-card bg-warning-soft p-3 text-fg">
          <input
            readOnly
            aria-label={`${title} link`}
            value={shown}
            onFocus={(e) => e.target.select()}
            className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-caption"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(shown)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a className={small} href={webcalUrl(shown)}>
              Subscribe on this device
            </a>
          </div>
          <p className="mt-1 text-caption text-fg-muted">
            Shown only now: Airhead keeps just a fingerprint of it. Anyone with the link can see
            this calendar; “New link” or “Turn off” stops the old one.
          </p>
        </div>
      )}
    </div>
  );
}

/** Settings → Sharing (Task 4.8): private subscribe links for the Us calendar and my phone. */
export default function SharingSettings() {
  const { services } = useAuth();
  const canPublish = services.auth.mode !== 'local' && !!feedUrl('x');
  return (
    <div className="divide-y divide-border/70">
      {KINDS.map((k) => (
        <FeedRow key={k.kind} {...k} canPublish={canPublish} />
      ))}
    </div>
  );
}
