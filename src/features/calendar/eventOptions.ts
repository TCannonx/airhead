/** Per-event reminder (Task 4.12): '' = the default from Settings → Notifications. */
export const REMINDERS: { value: string; label: string }[] = [
  { value: '', label: 'Default reminder' },
  { value: 'none', label: 'No reminder' },
  { value: '0', label: 'At the start' },
  { value: '10', label: '10 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '120', label: '2 hours before' },
  { value: '1440', label: '1 day before' },
];

export const REPEATS: { value: string; label: string }[] = [
  { value: '', label: 'Does not repeat' },
  { value: 'FREQ=DAILY', label: 'Every day' },
  { value: 'FREQ=WEEKLY', label: 'Every week' },
  { value: 'FREQ=MONTHLY', label: 'Every month' },
  { value: 'FREQ=YEARLY', label: 'Every year' },
];

export const reminderLabel = (value: unknown): string =>
  REMINDERS.find((r) => r.value === (typeof value === 'string' ? value : ''))?.label ??
  'Default reminder';
