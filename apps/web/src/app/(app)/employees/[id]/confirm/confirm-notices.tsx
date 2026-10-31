'use client';

import { useSearchParams } from 'next/navigation';

// Small client parts of the confirmation: they read the address, which the profile header doesn't get.

/** On the profile, after Confirm my details (?confirmed=1): the thanks. Gone once the address changes (e.g. another tab). */
export function ConfirmedNotice() {
  const confirmed = useSearchParams().get('confirmed') === '1';
  if (!confirmed) return null;
  return (
    <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
      Thank you, your details are confirmed.
    </p>
  );
}
