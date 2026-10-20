'use client';

import { useEffect, useState } from 'react';
import { FingerprintIcon } from '@/components/fingerprint-icon';
import { dismissOffer, FINGERPRINT_TEXT, offerDismissed } from '@/lib/fingerprint';
import { biometricStatus, type BiometricStatus } from '@/lib/native';
import { useTurnOnFingerprint } from '@/lib/use-fingerprint';
import { DoneLine } from './ui';

// Home's offer of fingerprint sign-in (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the app; README:
// "Sign-in: Face ID / fingerprint after the first password sign-in"): in the app, signed in on an app session and not
// viewing as someone (Home decides that), when the phone has a fingerprint to use and keeps no sign-in behind it yet,
// unless Not now was pressed on this phone. Turn on makes the credential and hands it to the phone's fingerprint; a
// closed prompt says nothing and the offer stays.

/** The page's storage, null when the browser refuses it (a private window, storage blocked). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function FingerprintOffer() {
  const [status, setStatus] = useState<BiometricStatus | null>(null);
  const [putOff, setPutOff] = useState(false);
  const { turnOn, pending, outcome } = useTurnOnFingerprint();

  useEffect(() => {
    let live = true;
    void biometricStatus().then((s) => {
      if (live && s.available && !s.enrolled && !offerDismissed(storage())) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, []);

  if (outcome?.kind === 'on') return <DoneLine text={FINGERPRINT_TEXT.on} />;
  if (!status || putOff || outcome?.kind === 'unavailable') return null;

  return (
    <section aria-label="Fingerprint sign-in" className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-accent">
          <FingerprintIcon className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{FINGERPRINT_TEXT.offer}</p>
          <p className="hint">{FINGERPRINT_TEXT.offerHint}</p>
        </div>
      </div>
      {outcome?.kind === 'error' && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {outcome.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => turnOn(status)} disabled={pending} className="btn btn-primary">
          {pending ? 'Turning on…' : 'Turn on'}
        </button>
        <button
          type="button"
          onClick={() => {
            dismissOffer(storage());
            setPutOff(true);
          }}
          disabled={pending}
          className="btn btn-secondary"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
