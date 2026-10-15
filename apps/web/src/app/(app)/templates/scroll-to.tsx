'use client';

import { useEffect } from 'react';

/**
 * Brings a part of the page into view once it is shown: the new draft's check, after Map Fields saved it. The address
 * names it (#draft-…) too, but the router can scroll to it before the page has streamed in.
 */
export function ScrollTo({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [id]);
  return null;
}
