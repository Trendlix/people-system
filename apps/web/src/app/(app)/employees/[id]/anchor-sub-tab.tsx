'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { anchorAddress, type EmploymentSubTabKey } from '../tab-list';

// Links from before the Employment tab had sub-tabs (17 October 2026) name an anchor only: ?tab=employment#payslips
// opens Details, where #payslips isn't. On load, and when the hash changes, this moves such a link to the sub-tab that
// holds the anchor, keeping the hash (so the page scrolls to it) and without a new entry in the history. It shows
// nothing.

export function AnchorSubTab({ visible }: { /** The sub-tabs the viewer sees. */ visible: EmploymentSubTabKey[] }) {
  const router = useRouter();
  // a string, so a new array with the same sub-tabs doesn't run it again
  const seen = visible.join(' ');
  useEffect(() => {
    const move = () => {
      const { pathname, search, hash } = window.location;
      const to = anchorAddress(`${pathname}${search}${hash}`, seen.split(' ') as EmploymentSubTabKey[]);
      if (to) router.replace(to);
    };
    move();
    window.addEventListener('hashchange', move);
    return () => window.removeEventListener('hashchange', move);
  }, [router, seen]);
  return null;
}
