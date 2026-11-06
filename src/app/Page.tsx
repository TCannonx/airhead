import type { ReactNode } from 'react';

export function Page({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </section>
  );
}
