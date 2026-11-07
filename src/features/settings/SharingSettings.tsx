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

const small =
  'rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800';

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
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mb-2 text-sm text-slate-500">{text}</p>
      {!canPublish ? (
        <p className="text-sm text-slate-500">Needs a server: links work once sync is set up.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {feed ? (
            <>
              <span className="text-sm text-slate-600 dark:text-slate-300">Link is on.</span>
              <button type="button" className={small} onClick={() => void issue()}>
                New link
              </button>
              <button
                type="button"
                className={`${small} text-red-600`}
                onClick={() => {
                  setShown(null);
                  void revokeFeed(db, feed.id);
                }}
              >
                Turn off
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
              onClick={() => void issue()}
            >
              Create link
            </button>
          )}
        </div>
      )}
      {shown && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/40">
          <input
            readOnly
            aria-label={`${title} link`}
            value={shown}
            onFocus={(e) => e.target.select()}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={small}
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(shown)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className={small} href={webcalUrl(shown)}>
              Subscribe on this device
            </a>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
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
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {KINDS.map((k) => (
        <FeedRow key={k.kind} {...k} canPublish={canPublish} />
      ))}
    </div>
  );
}
