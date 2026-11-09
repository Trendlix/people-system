'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// Back to the applicants' list where one was (owner, 9 November 2026: "when i click back it moves me to the begining of
// the page, make the back button take me a step back to where i was exactly"): opening an applicant from a list keeps
// that list's address and how far down it was (this tab only); the applicant's Back opens the list again and it scrolls
// back there once its rows are in. Opened another way (a notification, a new tab), Back opens the applicant's step and
// scrolls to their row. The browser's own back button is left as it is.

const KEY = 'people.applicants-list';

interface Spot {
  href: string;
  y: number;
  restore: boolean;
}

function read(): Spot | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Spot | null;
    return v && typeof v.href === 'string' && typeof v.y === 'number' ? v : null;
  } catch {
    return null;
  }
}

function write(spot: Spot) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(spot));
  } catch {
    // not kept (a private window): Back still opens the list, at the applicant's row
  }
}

/** An applicant's name in a list: opening it keeps the list and how far down it was. */
export function ApplicantRowLink({ href, listHref, className, children }: { href: string; listHref?: string; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={className} onClick={() => listHref && write({ href: listHref, y: window.scrollY, restore: false })}>
      {children}
    </Link>
  );
}

/** In a list, once its rows are in: back where it was when Back brought it here, else at the row its address names. */
export function ListScrollRestorer({ listHref }: { listHref: string }) {
  useEffect(() => {
    const spot = read();
    if (spot?.restore && spot.href === listHref) {
      write({ ...spot, restore: false });
      window.scrollTo({ top: spot.y });
      return;
    }
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id.startsWith('applicant-')) document.getElementById(id)?.scrollIntoView({ block: 'center' });
  }, [listHref]);
  return null;
}

/** The applicant's Back: the list it was opened from, where it was; its row named, for when nothing was kept. */
export function BackToList({ listHref, applicantId, children }: { listHref: string; applicantId: string; children: React.ReactNode }) {
  return (
    <Link
      href={`${listHref}#applicant-${applicantId}`}
      className="text-sm"
      onClick={() => {
        const spot = read();
        if (spot?.href === listHref) write({ ...spot, restore: true });
      }}
    >
      ← {children}
    </Link>
  );
}
