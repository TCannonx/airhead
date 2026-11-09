import { useState } from 'react';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { leaveRangeText } from '../../lib/db/leave';
import { updateSettingsData } from '../../lib/db/settings';
import { leaveYearFor } from '../../lib/leave/engine';
import type { LeaveBooking } from '../../lib/schemas/records';
import { leaveTypeOf } from '../../lib/work/settings';
import LeaveCounter from './LeaveCounter';
import LeaveIdeas from './LeaveIdeas';
import LeaveSheet from './LeaveSheet';
import { todayKey, useWork } from './useWork';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';
import { ListRow } from '../../ui/ListRow';
import { Sheet } from '../../ui/Sheet';
import { TextField } from '../../ui/TextField';

/** Work and leave (Task 4.6): the leave counter, bookings and the year's opening balance. */
export default function WorkPage() {
  const db = useDb();
  const { user } = useAuth();
  const data = useWork();
  const [open, setOpen] = useState<{
    booking?: LeaveBooking;
    initial?: { start_date: string; end_date: string };
  } | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  if (!data) return null;
  const { work, bookings } = data;
  const year = leaveYearFor(todayKey(), work);
  const inYear = bookings.filter((b) => b.end_date >= year.start && b.start_date <= year.end);
  const later = bookings.filter((b) => b.start_date > year.end);
  const opening = work.opening_carry_over[year.start];
  const usedBefore = work.opening_used[year.start];
  const show = (o: {
    booking?: LeaveBooking;
    initial?: { start_date: string; end_date: string };
  }) => {
    setOpen(o);
    setSheetKey((k) => k + 1);
  };

  const list = (rows: LeaveBooking[], label: string) => (
    <GroupedList label={label}>
      {rows.map((b) => (
        <ListRow
          key={b.id}
          title={<span className="font-medium">{leaveRangeText(b)}</span>}
          subtitle={leaveTypeOf(work, b.leave_type).name}
          trailing={
            <span className="text-footnote">
              {b.days ?? '?'} d · {b.status}
            </span>
          }
          onClick={() => show({ booking: b })}
        />
      ))}
    </GroupedList>
  );

  const dayField = (
    label: string,
    value: number | undefined,
    key: 'opening_carry_over' | 'opening_used',
  ) => (
    <TextField
      type="number"
      min="0"
      step="0.5"
      inputMode="decimal"
      label={label}
      hideLabel
      className="w-28"
      defaultValue={value ?? ''}
      key={String(value)}
      onBlur={(e) => {
        const v = e.target.value.trim();
        const next = Object.fromEntries(
          Object.entries(work[key]).filter(([k]) => k !== year.start),
        );
        if (v !== '' && !Number.isNaN(Number(v))) next[year.start] = Math.max(0, Number(v));
        void updateSettingsData(db, user?.id ?? '', { work: { ...work, [key]: next } });
      }}
    />
  );

  return (
    <Page
      title="Work and leave"
      actions={
        <Button variant="primary" size="sm" onClick={() => show({})}>
          Book leave
        </Button>
      }
    >
      <Section title="Leave this year">
        <Card>
          <LeaveCounter detailed />
          <div className="mt-4 border-t border-border/60 pt-4">
            <LeaveIdeas
              work={work}
              bookings={bookings}
              onBook={(b) =>
                show({
                  initial: { start_date: b.leave[0] ?? b.start, end_date: b.leave.at(-1) ?? b.end },
                })
              }
            />
          </div>
        </Card>
      </Section>

      <Sheet
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.booking ? 'Edit leave' : 'Book leave'}
      >
        {open && (
          <LeaveSheet
            key={sheetKey}
            inSheet
            work={work}
            bookings={bookings}
            booking={open.booking}
            initial={open.initial}
            onClose={() => setOpen(null)}
          />
        )}
      </Sheet>

      <Section title="Bookings">
        {inYear.length === 0 && later.length === 0 && (
          <GroupedList>
            <GroupedListItem>
              <p className="text-body text-fg-muted">No leave booked yet.</p>
            </GroupedListItem>
          </GroupedList>
        )}
        {inYear.length > 0 && list(inYear, 'This leave year')}
        {later.length > 0 && (
          <>
            <h3 className="mt-4 mb-1.5 px-4 text-footnote font-medium text-fg-muted">
              Next leave year
            </h3>
            {list(later, 'Next leave year')}
          </>
        )}
      </Section>

      <Section
        title="Carried into this leave year"
        footer="Leave blank to work it out from last year’s bookings. Enter it here for your first year in Airhead, or to match what HR says."
      >
        <GroupedList>
          <GroupedListItem className="flex items-center justify-between gap-3">
            <span className="text-body">Days carried over</span>
            {dayField('Days carried into this leave year', opening, 'opening_carry_over')}
          </GroupedListItem>
        </GroupedList>
      </Section>

      <Section
        title="Used before Airhead"
        footer="Leave you took this leave year before you started logging it here. It counts as taken."
      >
        <GroupedList>
          <GroupedListItem className="flex items-center justify-between gap-3">
            <span className="text-body">Days used</span>
            {dayField('Days used before Airhead', usedBefore, 'opening_used')}
          </GroupedListItem>
        </GroupedList>
      </Section>

      <Section>
        <GroupedList>
          <ListRow
            icon="settings"
            iconTint="bg-fg-subtle"
            title="Work settings"
            subtitle="Entitlement, leave year, holidays, locations"
            to="/settings"
          />
        </GroupedList>
      </Section>
    </Page>
  );
}
