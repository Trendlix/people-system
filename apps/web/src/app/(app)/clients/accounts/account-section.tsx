'use client';

import { useEffect, useRef } from 'react';

/**
 * An account's card. The one the address names (?account=<id>: the Audit Log links to it) is marked and scrolled to once
 * the page's content has streamed in, which a plain #anchor can't wait for.
 */
export function AccountSection({ id, focused, labelledBy, children }: { id: string; focused: boolean; labelledBy: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start' });
  }, [focused]);
  return (
    <section ref={ref} id={id} aria-labelledby={labelledBy} className={`card scroll-mt-4 space-y-4 p-5 ${focused ? 'ring-2 ring-accent' : ''}`}>
      {children}
    </section>
  );
}
