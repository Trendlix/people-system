'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { FingerprintIcon } from '@/components/fingerprint-icon';
import { signInWithFingerprint } from '@/lib/device-actions';
import { afterSignIn, afterUnlock, type FingerprintStep } from '@/lib/fingerprint';
import { biometricStatus, clearBiometric, unlockBiometric } from '@/lib/native';

// Sign in with fingerprint, on the sign-in page in the TrendLIX People app (owner, 20 October 2026: chose Face ID /
// fingerprint sign-in for the app; README: "Sign-in: Face ID / fingerprint after the first password sign-in"; "the
// app-start screen tries the biometric unlock first"). Only inside the app with a sign-in kept behind the phone's
// fingerprint: the button above the password, asked by itself once when the page opens, unless the person has just
// signed out (?reason=signed_out). The fingerprint unlocks the credential, which the server action trades for an app
// session and then opens `next` or the app's Home. Refused by the API (signed out, past its 90 days, a password
// changed) or a changed fingerprint: the phone's copy is forgotten and the password asked for. Outside the app: nothing.

export function FingerprintSignIn() {
  const params = useSearchParams();
  const next = params.get('next') ?? '';
  const signedOut = params.get('reason') === 'signed_out';
  const [shown, setShown] = useState(false);
  const [notice, setNotice] = useState<FingerprintStep['notice']>(null);
  const [asking, setAsking] = useState(false);
  const [signingIn, startSignIn] = useTransition();
  // the phone is looked at once, and the fingerprint asked for by itself at most once
  const looked = useRef(false);

  const apply = useCallback(async (step: FingerprintStep) => {
    if (step.clear) await clearBiometric();
    if (step.hide) setShown(false);
    setNotice(step.notice);
  }, []);

  const ask = useCallback(async () => {
    setNotice(null);
    setAsking(true);
    const unlocked = await unlockBiometric();
    setAsking(false);
    if (unlocked.kind !== 'unlocked') {
      await apply(afterUnlock(unlocked.kind));
      return;
    }
    // the secret goes from the phone's plugin to the action's request, and nowhere else
    const { id, secret } = unlocked;
    startSignIn(async () => {
      // signed in: the action opens the page itself
      const result = await signInWithFingerprint({ id, secret, next });
      await apply(afterSignIn(result ?? {}));
    });
  }, [apply, next]);

  useEffect(() => {
    if (looked.current) return;
    looked.current = true;
    void biometricStatus().then((status) => {
      if (!status.available || !status.enrolled) return;
      setShown(true);
      if (!signedOut) void ask();
    });
  }, [ask, signedOut]);

  if (!shown && !notice) return null;
  return (
    <div className="mb-4 space-y-4">
      {notice && (
        <p
          role={notice.tone === 'danger' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${notice.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}
        >
          {notice.text}
        </p>
      )}
      {shown && (
        <>
          <button type="button" onClick={() => void ask()} disabled={asking || signingIn} className="btn btn-primary w-full">
            <FingerprintIcon />
            {signingIn ? 'Signing in…' : 'Sign in with fingerprint'}
          </button>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
            or
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
    </div>
  );
}
