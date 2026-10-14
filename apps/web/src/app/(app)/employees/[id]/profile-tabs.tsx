'use client';

import Link from 'next/link';
import { useId, useRef } from 'react';

// The profile's tabs. Each tab is a link to the profile with ?tab=, so the tab survives a reload and the server renders
// only the open one. Keyboard as a tab list: the arrow keys, Home and End move between the tabs, Enter or Space opens one.

const base = 'inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold whitespace-nowrap no-underline outline-offset-2';

export function ProfileTabs({
  tabs,
  active,
  label,
  children,
}: {
  tabs: { key: string; label: string; href: string }[];
  active: string;
  /** What the tabs are of, for screen readers, e.g. "Profile of Omar Khaled". */
  label: string;
  /** The open tab's content. */
  children: React.ReactNode;
}) {
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
      <div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-6 overflow-x-auto border-b border-line">
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
              className={`${base} ${selected ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(active)} className="pt-6">
        {children}
      </div>
    </div>
  );
}
