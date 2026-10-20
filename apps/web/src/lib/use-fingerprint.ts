'use client';

import { useState, useTransition } from 'react';
import { forgetFingerprint, turnOnFingerprint } from './device-actions';
import { turnOnFingerprintFlow, type TurnOnOutcome } from './fingerprint';
import { enrollBiometric, type BiometricStatus } from './native';

// Turning on fingerprint sign-in for this phone (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the
// app; README: "Sign-in: Face ID / fingerprint after the first password sign-in"), for Home's offer and Your Sessions'
// Turn on for this phone alike: the server action makes the credential, the phone keeps it behind the fingerprint, and
// one the phone didn't keep is signed out again (lib/fingerprint.ts). The secret lives only in the flow's variable,
// from the action's answer to the phone's plugin. `pending` while the action and the phone's prompt are under way.

export function useTurnOnFingerprint(): {
  turnOn: (status: BiometricStatus, then?: (outcome: TurnOnOutcome) => void) => void;
  pending: boolean;
  outcome: TurnOnOutcome | null;
} {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<TurnOnOutcome | null>(null);

  function turnOn(status: BiometricStatus, then?: (outcome: TurnOnOutcome) => void) {
    setOutcome(null);
    startTransition(async () => {
      const result = await turnOnFingerprintFlow(status, navigator.userAgent, {
        make: turnOnFingerprint,
        enroll: (id, secret) => enrollBiometric(id, secret),
        // nothing on the page to show again: the list (Your Sessions) never listed it
        forget: (id) => forgetFingerprint(id, { refresh: false }),
      });
      setOutcome(result);
      then?.(result);
    });
  }

  return { turnOn, pending, outcome };
}
