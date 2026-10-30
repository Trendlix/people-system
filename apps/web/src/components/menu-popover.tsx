'use client';

import { useEffect, useRef } from 'react';

/**
 * A drop-down that opens from its button (a <details>, so it works before the page's script runs) and closes on a click
 * elsewhere, on Escape, and after a choice in it. The header's account menu (the owner's design, 30 October 2026).
 */
export function MenuPopover({ summary, label, children }: { summary: React.ReactNode; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        el.open = false;
        el.querySelector('summary')?.focus();
        return;
      }
      if (!el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details ref={ref} className="group relative">
      <summary aria-label={label} className="list-none [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div
        className="absolute right-0 z-40 mt-2 w-64 rounded-[14px] border border-line bg-card p-1.5 shadow-card"
        onClick={(e) => {
          // a link followed or a button pressed: the menu closes behind it
          if ((e.target as HTMLElement).closest('a, button') && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
