import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Card } from './Card';
import { Badge, Chip } from './Chip';
import { EmptyState } from './EmptyState';
import { GroupedList, GroupedListItem, Section } from './GroupedList';
import { IconButton } from './IconButton';
import { ListRow } from './ListRow';
import { PageHeader } from './PageHeader';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';
import { Sheet } from './Sheet';
import { TextArea } from './TextArea';
import { TextField } from './TextField';
import { Toast } from './Toast';
import { Toggle } from './Toggle';

const SWATCHES = [
  'canvas',
  'surface',
  'surface-raised',
  'fill',
  'border',
  'fg',
  'fg-muted',
  'accent',
  'accent-soft',
  'danger',
  'success',
  'warning',
] as const;

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <Card className="flex flex-wrap items-center gap-3">{children}</Card>
    </Section>
  );
}

function Kit({ theme }: { theme: 'light' | 'dark' }) {
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');
  const [on, setOn] = useState(true);
  const [filter, setFilter] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = theme === 'light' ? 'Light' : 'Dark';

  return (
    <div
      role="region"
      aria-label={name}
      data-theme={theme}
      className="min-w-0 flex-1 rounded-sheet bg-canvas p-4 text-fg"
    >
      <p className="mb-4 text-headline">{name}</p>

      <Demo title="Colours">
        {SWATCHES.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-caption">
            <span
              className="size-5 rounded-md border border-border"
              style={{ background: `var(--color-${s})` }}
            />
            {s}
          </span>
        ))}
      </Demo>

      <Demo title="Type">
        <div className="space-y-1">
          <p className="text-title">Title</p>
          <p className="text-headline">Headline</p>
          <p className="text-body">Body text for reading.</p>
          <p className="text-footnote text-fg-muted">Footnote</p>
          <p className="text-caption text-fg-muted">Caption</p>
        </div>
      </Demo>

      <Demo title="Buttons">
        <Button variant="primary">Save</Button>
        <Button>Sync now</Button>
        <Button variant="plain">Edit</Button>
        <Button variant="destructive">Delete</Button>
        <Button size="sm">Small</Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 1500);
          }}
        >
          Loading demo
        </Button>
        <IconButton icon="settings" label="Settings" />
        <IconButton icon="close" label="Close" tone="danger" />
      </Demo>

      <Demo title="Chips and badges">
        <Chip>Neutral</Chip>
        <Chip tone="accent">This device</Chip>
        <Chip tone="success">Done</Chip>
        <Chip tone="warning">Waiting</Chip>
        <Chip tone="danger">Failed</Chip>
        <Chip selected={filter} onClick={() => setFilter((f) => !f)}>
          Filter
        </Chip>
        <Badge count={3} />
        <Badge count={120} />
      </Demo>

      <Demo title="Segmented control">
        <SegmentedControl
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
        />
      </Demo>

      <Section title="Grouped list" footer="Rows are at least 44 px tall.">
        <GroupedList label={`Example list (${name})`}>
          <ListRow icon="calendar" title="Linked calendars" subtitle="2 calendars" to="/ui" />
          <ListRow icon="settings" iconTint="bg-fg-subtle" title="Sync now" onClick={() => {}} />
          <ListRow title="Version" trailing="1.0" />
          <ListRow title="This device" trailing={<Chip tone="accent">Current</Chip>} />
          <GroupedListItem>
            <Toggle label="Morning brief" checked={on} onChange={setOn} hint="At 07:30" />
          </GroupedListItem>
          <ListRow title="Sign out" destructive onClick={() => {}} chevron={false} />
        </GroupedList>
      </Section>

      <Demo title="Fields">
        <div className="grid w-full gap-3">
          <TextField label="Name" placeholder="Airhead" />
          <TextField label="Email" type="email" error="Enter an email address." />
          <TextArea label="Notes" hint="Plain text." />
          <Select
            label="Calendar"
            options={[
              { value: 'personal', label: 'Personal' },
              { value: 'work', label: 'Work' },
            ]}
          />
        </div>
      </Demo>

      <Section title="Empty state">
        <Card flush>
          <EmptyState
            icon="inbox"
            title="Inbox is clear"
            message="New captures wait here until they are sorted."
            action={<Button variant="primary">Capture something</Button>}
          />
        </Card>
      </Section>

      <Demo title="Sheet and toast">
        <Button onClick={() => setSheet(true)}>Open sheet</Button>
        <Button onClick={() => setToast(true)}>Show toast</Button>
      </Demo>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Example sheet"
        footer={
          <>
            <Button variant="plain" onClick={() => setSheet(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setSheet(false)}>
              Done
            </Button>
          </>
        }
      >
        <TextField label="Title" />
      </Sheet>
      {toast && (
        <Toast
          message="Event added"
          action={{ label: 'Undo', onClick: () => {} }}
          onDismiss={() => setToast(false)}
        />
      )}
    </div>
  );
}

/** Every shared component in light and dark (Settings → About → Design kit, or /ui). */
export default function DesignKitPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Design kit" back={{ to: '/settings', label: 'Settings' }} />
      <p className="mb-6 text-footnote text-fg-muted">
        The shared components from src/ui, in both colour schemes. See docs/UI.md.
      </p>
      <div className="flex flex-col gap-4 xl:flex-row">
        <Kit theme="light" />
        <Kit theme="dark" />
      </div>
    </div>
  );
}
