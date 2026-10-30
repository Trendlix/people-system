'use client';

import { Moon, Sun } from 'lucide-react';
import { THEME_KEY } from '@/lib/theme';

// The sun or the moon in the header (the owner's design has both looks, and this switch, 30 October 2026): as the
// computer is set until the person picks one, then theirs, kept in this browser only (lib/theme.ts), not the account.

/** The look showing now: the one picked, else the computer's. */
function showing(): 'light' | 'dark' {
  const picked = document.documentElement.dataset.theme;
  if (picked === 'light' || picked === 'dark') return picked;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The sun or the moon: switches to the other look, and keeps it for next time. */
export function ThemeSwitch({ className = '' }: { className?: string }) {
  const toggle = () => {
    const next = showing() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // not kept: it still applies on this page
    }
  };
  // both icons drawn, the look's own shown by CSS (dark: the sun, to go light), so the server's page is right at once
  return (
    <button
      type="button"
      onClick={toggle}
      title="Light or dark"
      aria-label="Switch between light and dark"
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-card text-ink transition-colors hover:bg-raised ${className}`}
    >
      <Moon aria-hidden="true" className="size-[18px] dark:hidden" strokeWidth={1.6} />
      <Sun aria-hidden="true" className="hidden size-[18px] dark:block" strokeWidth={1.6} />
    </button>
  );
}
