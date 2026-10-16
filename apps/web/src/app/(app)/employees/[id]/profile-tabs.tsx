'use client';

import Link from 'next/link';
import { useId, useRef } from 'react';

// The profile's tabs, and the same smaller for the Employment tab's sub-tabs (Details | Salary | Issued Documents, owner's
// choice, 17 October 2026). Each tab is a link to the profile with ?tab= (a sub-tab with &sub=), so the tab survives a
// reload and the server renders only the open one. Keyboard as a tab list: the arrow keys, Home and End move between
// the tabs, Enter or Space opens one.

const base = 'inline-flex items-center border-b-2 px-1 font-semibold whitespace-nowrap no-underline outline-offset-2';

const SIZES = {
  // the profile's own tabs
  large: { list: 'gap-6', tab: 'min-h-11 text-sm', panel: 'pt-6' },
  // a tab's sub-tabs, a step down
  small: { list: 'gap-5', tab: 'min-h-9 text-[13px]', panel: 'pt-5' },
} as const;

export function ProfileTabs({
  tabs,
  active,
  label,
  size = 'large',
  children,
}: {
  tabs: { key: string; label: string; href: string }[];
  active: string;
  /** What the tabs are of, for screen readers, e.g. "Profile of Omar Khaled". */
  label: string;
  /** Small: sub-tabs inside a tab. */
  size?: keyof typeof SIZES;
  /** The open tab's content. */
  children: React.ReactNode;
}) {
  const sized = SIZES[size];
  // ids from useId: Next.js keeps recently visited pages mounted (hidden), so fixed ids could appear twice
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const tabId = (key: string) => `${id}tab-${key}`;
  const panelId = `${id}panel`;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? [])];
    const at = links.findIndex((l) => l === document.activeElement);
    if (at < 0) return;
    if (e.key === ' ') {
      e.preventDefault();
      links[at].click();
      return;
    }
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: links.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    links[(to + links.length) % links.length].focus();
  }

  return (
    <div>
      <div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`flex ${sized.list} overflow-x-auto border-b border-line`}>
        {tabs.map((t) => {
          const selected = t.key === active;
          return (
            <Link
              key={t.key}
              id={tabId(t.key)}
              href={t.href}
              scroll={false}
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              className={`${base} ${sized.tab} ${selected ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(active)} className={sized.panel}>
        {children}
      </div>
    </div>
  );
}
