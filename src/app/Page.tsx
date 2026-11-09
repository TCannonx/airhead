import type { ReactNode } from 'react';
import { PageHeader, type PageHeaderProps } from '../ui/PageHeader';

/**
 * Every page's container: a reading column (or the full width) with the shared
 * PageHeader on top. Padding comes from the shell's <main>.
 */
export function Page({
  title,
  children,
  wide = false,
  actions,
  back,
}: {
  title: string;
  children?: ReactNode;
  /** Use the full width (e.g. the calendar) instead of a reading column. */
  wide?: boolean;
  actions?: PageHeaderProps['actions'];
  back?: PageHeaderProps['back'];
}) {
  return (
    <section className={wide ? 'mx-auto max-w-none' : 'mx-auto max-w-3xl'}>
      <PageHeader title={title} actions={actions} back={back} />
      {children}
    </section>
  );
}
