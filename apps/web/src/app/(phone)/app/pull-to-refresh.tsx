'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { PULL_TRIGGER, pullDistance, REFRESH_MIN_MS, refreshes, touchKind } from '@/lib/pull-to-refresh';

// Pull to refresh on the phone pages (owner, 20 October 2026: the employee app; apps/mobile/README.md, Phase 5: "a light
// custom pull-down gesture at the top of the page that calls router.refresh(), with a spinner. Touch only … it must not
// fight the page's scrolling, the maps or the inputs"). A finger that pulls down while the page is at its top brings a
// circle down from under the top bar; let go past the mark and the page is read again from the server (router.refresh:
// what is typed and where the page is stay), the circle turning until it is. The touch listeners are passive and never
// stop the page: a touch that scrolls, swipes sideways, starts on a map, a field, a pop-up window or a box scrolled on
// its own, or begins with the page scrolled, is left alone. The phone's own pull to refresh (a phone's browser) and the
// stretch at the top are turned off on these pages, so there is one. The lines of lib/pull-to-refresh.ts.

/** Where a pull never starts: fields, maps, drawn PDFs, pop-up windows, and anything marked so. */
const NOT_FROM = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .leaflet-container, canvas, dialog, [data-no-pull]';

/** Whether a touch on `target` may start a pull: nothing it is in scrolls on its own away from its top. */
function mayStartOn(target: EventTarget | null): boolean {
  if (document.querySelector('dialog[open]')) return false;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false;
  if (!(target instanceof Element)) return true;
  if (target.closest(NOT_FROM)) return false;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
  }
  return true;
}

const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;

/** The circle `distance` px down from under the top bar (0: out of sight under it), its arrow turning as it comes. */
function place(circle: HTMLElement | null, arrow: SVGSVGElement | null, distance: number, animate: boolean) {
  if (!circle) return;
  circle.style.transition = animate ? 'transform 200ms ease-out, opacity 200ms ease-out' : 'none';
  circle.style.transform = `translateY(${distance - 48}px)`;
  circle.style.opacity = String(Math.min(1, distance / PULL_TRIGGER));
  if (arrow) arrow.style.transform = `rotate(${Math.round((distance / PULL_TRIGGER) * 270)}deg)`;
}

export function PullToRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [held, setHeld] = useState(false);
  const refreshing = isPending || held;
  const circle = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGSVGElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = 'none';

    let start: { x: number; y: number } | null = null;
    let kind: 'undecided' | 'pull' | 'not-ours' = 'not-ours';
    let distance = 0;
    let holding: ReturnType<typeof setTimeout> | undefined;
    const move = (to: number, animate: boolean) => place(circle.current, arrow.current, to, animate);

    const top = () => {
      const header = document.querySelector('[data-phone-header]');
      return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    };
    const reset = () => {
      start = null;
      kind = 'not-ours';
      distance = 0;
    };

    const onStart = (e: TouchEvent) => {
      reset();
      if (busy.current || e.touches.length !== 1 || !atTop() || !mayStartOn(e.target)) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      kind = 'undecided';
      if (circle.current) circle.current.style.top = `${top()}px`;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || kind === 'not-ours') return;
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t || !atTop()) {
        kind = 'not-ours';
        move(0, true);
        return;
      }
      if (kind === 'undecided') kind = touchKind(t.clientX - start.x, t.clientY - start.y);
      if (kind !== 'pull') return;
      distance = pullDistance(t.clientY - start.y);
      move(distance, false);
    };
    const onEnd = () => {
      const pulled = kind === 'pull' ? distance : null;
      reset();
      // a tap, a scroll or a swipe: nothing was moved
      if (pulled === null) return;
      if (!refreshes(pulled)) {
        move(0, true);
        return;
      }
      busy.current = true;
      move(PULL_TRIGGER, true);
      setHeld(true);
      clearTimeout(holding);
      holding = setTimeout(() => setHeld(false), REFRESH_MIN_MS);
      startTransition(() => router.refresh());
    };
    const onCancel = () => {
      reset();
      move(0, true);
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
      clearTimeout(holding);
      root.style.overscrollBehaviorY = before;
    };
  }, [router]);

  // no new pull while the page is read again; once it is, the circle goes back up
  useEffect(() => {
    busy.current = refreshing;
    if (!refreshing) place(circle.current, arrow.current, 0, true);
  }, [refreshing]);

  return (
    <>
      <div ref={circle} aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center opacity-0" style={{ transform: 'translateY(-48px)' }}>
        <span className="mt-2 flex size-10 items-center justify-center rounded-full border border-line bg-card text-accent shadow-md">
          <svg ref={arrow} viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <g className={refreshing ? 'origin-center motion-safe:animate-spin' : undefined}>
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4.5v4h-4" strokeLinejoin="round" />
            </g>
          </svg>
        </span>
      </div>
      <p role="status" className="sr-only">
        {refreshing ? 'Refreshing…' : ''}
      </p>
    </>
  );
}
