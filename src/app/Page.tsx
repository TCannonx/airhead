import type { ReactNode } from 'react';

export function Page({
  title,
  children,
  wide = false,
}: {
  title: string;
  children?: ReactNode;
  /** Use the full width (e.g. the calendar) instead of a reading column. */
  wide?: boolean;
}) {
  return (
    <section className={wide ? 'mx-auto max-w-none' : 'mx-auto max-w-3xl'}>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </section>
  );
}
