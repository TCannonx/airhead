import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { draftsFor } from '../../lib/db/workshop';
import { draftSchema, type Draft } from '../../lib/schemas/records';
import { useOnline } from '../../lib/useOnline';
import { FLESH_OUT_COST_TEXT } from '../../lib/workshop/cost';
import NextSteps from './NextSteps';
import SessionPanel from './SessionPanel';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { buttonClasses } from '../../ui/buttonClasses';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Section } from '../../ui/GroupedList';

function DraftView({ draft }: { draft: Draft }) {
  const c = draft.content;
  return (
    <article aria-label={`Draft version ${draft.version}`} className="space-y-3">
      {c.summary && <p>{c.summary}</p>}
      {c.sections.map((s, i) => (
        <section key={i}>
          <h3 className="font-semibold">{s.heading}</h3>
          <p className="whitespace-pre-wrap text-fg-muted">{s.body}</p>
        </section>
      ))}
      {c.open_questions.length > 0 && (
        <section>
          <h3 className="font-semibold">Open questions</h3>
          <ul className="list-disc pl-5">
            {c.open_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
      <NextSteps itemId={draft.item_id} steps={c.next_steps} />
    </article>
  );
}

/**
 * The Workshop for one item (Task 7.6): its newest draft, older versions one
 * tap away, a link to the original, and Auto flesh-out (online, one AI call).
 */
export default function WorkshopPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const { services } = useAuth();
  const online = useOnline();
  const data = useLiveQuery(
    async () => ({ item: await db.items.get(id), drafts: await draftsFor(db, id) }),
    [db, id],
  );
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const workshop = services.workshop;

  if (!data) return <Page title="Workshop" />;
  const { item, drafts } = data;
  if (!item || item.deleted_at)
    return (
      <Page title="Not found" back={{ to: '/inbox', label: 'Inbox' }}>
        <EmptyState
          icon="inbox"
          title="Nothing here"
          message="This idea doesn’t exist or is in the Trash."
          action={
            <Link to="/inbox" className={buttonClasses('secondary', 'md')}>
              Back to the Inbox
            </Link>
          }
        />
      </Page>
    );
  const current = drafts.find((d) => d.id === shown) ?? drafts[0];

  const fleshOut = async () => {
    if (!workshop) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await workshop.fleshOut(item.id);
      if (!res.ok) {
        setMessage(res.message);
        return;
      }
      // Show it now; the next sync brings the same row.
      const row = draftSchema.safeParse(res.draft);
      if (row.success) await db.drafts.put(row.data);
      setShown(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={item.title || 'Workshop'} back={{ to: '/inbox', label: 'Inbox' }}>
      <Link to={`/library/item/${item.id}`} className={buttonClasses('plain', 'sm', '-ml-3 mb-3')}>
        Open the original
      </Link>
      <Card>
        {current ? (
          <DraftView draft={current} />
        ) : (
          <p className="text-body text-fg-muted">
            No draft yet. Auto flesh-out writes a first one.
          </p>
        )}
      </Card>
      <div className="mt-4 mb-8 flex flex-wrap items-center gap-3">
        {workshop ? (
          <>
            <Button
              variant="primary"
              loading={busy}
              disabled={!online}
              onClick={() => void fleshOut()}
            >
              {busy ? 'Thinking…' : drafts.length ? 'Flesh out again' : 'Auto flesh-out'}
            </Button>
            <span className="text-caption text-fg-muted">
              {online ? `One AI call, ${FLESH_OUT_COST_TEXT}.` : 'Fleshing out needs a connection.'}
            </span>
          </>
        ) : (
          <span className="text-footnote text-fg-muted">
            The Workshop needs Airhead&apos;s server (sign in).
          </span>
        )}
      </div>
      {message && (
        <p role="status" className="mt-2 text-footnote text-warning">
          {message}
        </p>
      )}
      <SessionPanel itemId={item.id} />
      {drafts.length > 1 && (
        <Section title="Versions" label="Versions">
          <ul className="flex flex-wrap gap-2">
            {drafts.map((d) => (
              <li key={d.id}>
                <Chip
                  selected={d.id === current?.id}
                  onClick={() => setShown(d.id)}
                  className="pointer-coarse:min-h-11"
                >
                  Version {d.version}
                </Chip>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
