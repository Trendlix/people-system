'use client';

import { useEffect, useRef } from 'react';

/**
 * A section that links can jump to with #id (e.g. "Edit department" on the list → #edit). The page's content streams
 * in after a link is followed, so the browser finds nothing to scroll to at first; this scrolls once it is here.
 */
export function AnchorSection({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.location.hash === `#${id}`) ref.current?.scrollIntoView();
  }, [id]);
  return (
    <section ref={ref} id={id} className={className}>
      {children}
    </section>
  );
}
