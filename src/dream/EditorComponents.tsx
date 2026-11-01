import type { ReactNode } from 'react';

/** Reusable inspector section, with a stable visual and heading hierarchy. */
export function InspectorSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="dream-panel">
      <div className="dream-panel-title">
        <span>{number}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
